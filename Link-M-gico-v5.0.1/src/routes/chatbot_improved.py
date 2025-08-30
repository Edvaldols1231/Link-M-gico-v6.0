from flask import Blueprint, request, jsonify, session
from src.database.db_instance import db
from src.models.chatbot import Conversation, WebData, KnowledgeBase
from src.services.ai_engine_improved import AIConversationEngine  # Alterado para usar a versão melhorada
from src.services.web_extractor import UniversalWebExtractor
import json
import uuid
import logging
from datetime import datetime, timedelta

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

chatbot_bp = Blueprint('chatbot', __name__)

# Instâncias dos serviços
ai_engine = AIConversationEngine()
web_extractor = UniversalWebExtractor()

@chatbot_bp.route("/create-session", methods=["POST"])
def create_chatbot_session():
    """Cria uma sessão persistente para o chatbot e retorna um ID de sessão."""
    try:
        data = request.get_json()
        if not data or "robot_name" not in data or "url" not in data:
            return jsonify({"error": "Nome do robô e URL são obrigatórios"}), 400

        robot_name = data["robot_name"].strip()
        url = data["url"].strip()
        instructions = data.get("instructions", "").strip()

        if not url:
            return jsonify({"error": "URL não pode estar vazia"}), 400

        # Extrai e cacheia os dados da web para a URL fornecida
        web_data_result = extract_and_cache_web_data(url)
        if not web_data_result["success"]:
            return jsonify({"success": False, "error": web_data_result.get("error", "Erro ao extrair dados da URL")}), 400

        # Gera um session_id único para esta configuração
        session_id = str(uuid.uuid4())

        # Cria uma entrada na tabela de conversas para associar a sessão à configuração
        # Usaremos a primeira mensagem como um marcador para a configuração inicial
        initial_message = f"Chatbot ativado com nome: {robot_name}, URL: {url}, Instruções: {instructions}"
        conversation = Conversation(
            session_id=session_id,
            user_message=initial_message,
            bot_response="Sessão de chatbot criada com sucesso.",
            context_data=json.dumps({
                "robot_name": robot_name,
                "url": url,
                "instructions": instructions,
                "web_data": web_data_result["data"]
            }),
            sentiment_score=0.0
        )
        db.session.add(conversation)
        db.session.commit()

        logger.info(f"Sessão de chatbot criada: {session_id} para URL: {url}")

        return jsonify({"success": True, "session_id": session_id}), 201

    except Exception as e:
        logger.error(f"Erro ao criar sessão de chatbot: {e}", exc_info=True)
        return jsonify({"success": False, "error": "Erro interno do servidor ao criar sessão"}), 500


@chatbot_bp.route("/chat", methods=["POST", "GET"])
@chatbot_bp.route("/chat/<session_id>", methods=["POST", "GET"])
def chat(session_id=None):
    """Endpoint principal para conversação com o chatbot"""
    try:
        data = request.get_json()
        
        if not data or 'message' not in data:
            return jsonify({'error': 'Mensagem é obrigatória'}), 400
        
        user_message = data['message'].strip()
        session_id = data.get('session_id') or str(uuid.uuid4())
        url_context = data.get('url')  # URL para extração de contexto
        
        if not user_message:
            return jsonify({'error': 'Mensagem não pode estar vazia'}), 400
        
        # Extrai dados da web se URL fornecida
        web_data = None
        logger.info(f"URL de contexto recebida: {url_context}")
        if url_context:
            web_data = extract_and_cache_web_data(url_context)
            logger.info(f"Resultado da extração de web_data: {web_data}")
        
        # Recupera contexto da conversa
        conversation_context = ai_engine.get_conversation_context(session_id)
        
        # Adiciona dados da web ao contexto se disponível
        if web_data and web_data.get('success'):
            conversation_context['web_data'] = web_data['data']
        
        # Gera resposta usando IA
        bot_response = ai_engine.generate_persuasive_response(
            user_message, 
            conversation_context, 
            web_data['data'] if web_data and web_data.get('success') else None
        )
        
        # Salva conversa no banco
        conversation = Conversation(
            session_id=session_id,
            user_message=user_message,
            bot_response=bot_response,
            context_data=json.dumps(conversation_context),
            sentiment_score=0.0  # TODO: Implementar análise de sentimento
        )
        db.session.add(conversation)
        db.session.commit()
        
        # Atualiza histórico na memória
        ai_engine.update_conversation_history(
            session_id, user_message, bot_response, conversation_context
        )
        
        return jsonify({
            'success': True,
            'response': bot_response,
            'session_id': session_id,
            'timestamp': datetime.utcnow().isoformat(),
            'has_web_context': web_data is not None and web_data.get('success', False)
        })
        
    except Exception as e:
        logger.error(f"Erro no chat: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor',
            'response': 'Desculpe, ocorreu um erro. Pode tentar novamente?'
        }), 500

@chatbot_bp.route('/extract-url', methods=['POST'])
def extract_url():
    """Endpoint para extrair dados de uma URL"""
    try:
        data = request.get_json()
        
        if not data or 'url' not in data:
            return jsonify({'error': 'URL é obrigatória'}), 400
        
        url = data['url'].strip()
        method = data.get('method', 'auto')
        force_refresh = data.get('force_refresh', False)
        
        if not url:
            return jsonify({'error': 'URL não pode estar vazia'}), 400
        
        # Verifica se já existe no cache (se não forçar refresh)
        if not force_refresh:
            cached_data = WebData.query.filter_by(url=url).first()
            if cached_data and (datetime.utcnow() - cached_data.last_updated) < timedelta(hours=24):
                return jsonify({
                    'success': True,
                    'data': cached_data.to_dict(),
                    'cached': True
                })
        
        # Extrai dados
        extracted_data = web_extractor.extract_data(url, method)
        
        if extracted_data['success']:
            # Salva ou atualiza no banco
            web_data = WebData.query.filter_by(url=url).first()
            if web_data:
                web_data.title = extracted_data['data'].get('title', '')
                web_data.content = extracted_data["data"].get("summary", "")
                web_data.extracted_data = json.dumps(extracted_data['data'])
                web_data.last_updated = datetime.utcnow()
                web_data.extraction_method = extracted_data['method']
            else:
                web_data = WebData(
                    url=url,
                    title=extracted_data['data'].get('title', ''),
                    content=extracted_data['data'].get('summary', ''),
                    extracted_data=json.dumps(extracted_data['data']),
                    extraction_method=extracted_data['method']
                )
                db.session.add(web_data)
            
            db.session.commit()
            
            return jsonify({
                'success': True,
                'data': extracted_data,
                'cached': False
            })
        else:
            return jsonify({
                'success': False,
                'error': extracted_data.get('error', 'Erro na extração'),
                'data': extracted_data
            }), 400
            
    except Exception as e:
        logger.error(f"Erro na extração de URL: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500

@chatbot_bp.route('/conversation-history/<session_id>', methods=['GET'])
def get_conversation_history(session_id):
    """Recupera histórico de conversa"""
    try:
        conversations = Conversation.query.filter_by(session_id=session_id).order_by(Conversation.timestamp).all()
        
        history = []
        for conv in conversations:
            history.append({
                'id': conv.id,
                'user_message': conv.user_message,
                'bot_response': conv.bot_response,
                'timestamp': conv.timestamp.isoformat(),
                'sentiment_score': conv.sentiment_score
            })
        
        return jsonify({
            'success': True,
            'session_id': session_id,
            'history': history,
            'total_messages': len(history)
        })
        
    except Exception as e:
        logger.error(f"Erro ao recuperar histórico: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500

@chatbot_bp.route('/knowledge-base', methods=['GET', 'POST'])
def manage_knowledge_base():
    """Gerencia base de conhecimento"""
    if request.method == 'GET':
        try:
            category = request.args.get('category')
            keyword = request.args.get('keyword')
            
            query = KnowledgeBase.query
            
            if category:
                query = query.filter_by(category=category)
            if keyword:
                query = query.filter(KnowledgeBase.keyword.contains(keyword))
            
            knowledge_items = query.order_by(KnowledgeBase.priority.desc()).all()
            
            return jsonify({
                'success': True,
                'items': [item.to_dict() for item in knowledge_items],
                'total': len(knowledge_items)
            })
            
        except Exception as e:
            logger.error(f"Erro ao recuperar base de conhecimento: {e}")
            return jsonify({
                'success': False,
                'error': 'Erro interno do servidor'
            }), 500
    
    elif request.method == 'POST':
        try:
            data = request.get_json()
            
            required_fields = ['category', 'keyword', 'content']
            if not all(field in data for field in required_fields):
                return jsonify({'error': 'Campos obrigatórios: category, keyword, content'}), 400
            
            knowledge_item = KnowledgeBase(
                category=data['category'],
                keyword=data['keyword'],
                content=data['content'],
                priority=data.get('priority', 1)
            )
            
            db.session.add(knowledge_item)
            db.session.commit()
            
            return jsonify({
                'success': True,
                'item': knowledge_item.to_dict()
            }), 201
            
        except Exception as e:
            logger.error(f"Erro ao adicionar à base de conhecimento: {e}")
            return jsonify({
                'success': False,
                'error': 'Erro interno do servidor'
            }), 500

@chatbot_bp.route('/analytics', methods=['GET'])
def get_analytics():
    """Retorna analytics básicas do chatbot"""
    try:
        # Total de conversas
        total_conversations = Conversation.query.count()
        
        # Conversas nas últimas 24h
        yesterday = datetime.utcnow() - timedelta(days=1)
        recent_conversations = Conversation.query.filter(Conversation.timestamp >= yesterday).count()
        
        # Sessões únicas
        unique_sessions = db.session.query(Conversation.session_id).distinct().count()
        
        # URLs mais extraídas
        popular_urls = db.session.query(WebData.url, WebData.title).limit(10).all()
        
        return jsonify({
            'success': True,
            'analytics': {
                'total_conversations': total_conversations,
                'recent_conversations': recent_conversations,
                'unique_sessions': unique_sessions,
                'popular_urls': [{'url': url, 'title': title} for url, title in popular_urls]
            }
        })
        
    except Exception as e:
        logger.error(f"Erro ao recuperar analytics: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500

def extract_and_cache_web_data(url: str) -> dict:
    """Função auxiliar para extrair e cachear dados da web"""
    logger.info(f"Iniciando extração e cache para a URL: {url}")
    try:
        # Verifica cache primeiro
        cached_data = WebData.query.filter_by(url=url).first()
        if cached_data and (datetime.utcnow() - cached_data.last_updated) < timedelta(hours=6):
            logger.info(f"Dados encontrados no cache para a URL: {url}")
            return {
                'success': True,
                'data': json.loads(cached_data.extracted_data),
                'cached': True
            }
        
        logger.info(f"Cache não encontrado ou expirado para a URL: {url}. Iniciando nova extração.")
        # Extrai dados
        extracted_data = web_extractor.extract_data(url)
        logger.info(f"Dados extraídos para a URL {url}: {extracted_data}")
        
        if extracted_data['success']:
            logger.info(f"Extração bem-sucedida para a URL: {url}. Salvando no cache.")
            # Salva no cache
            if cached_data:
                logger.info(f"Atualizando cache existente para a URL: {url}")
                cached_data.title = extracted_data["data"].get("title", "")
                cached_data.content = extracted_data["data"].get("summary", "")
                cached_data.extracted_data = json.dumps(extracted_data["data"])
                cached_data.last_updated = datetime.utcnow()
                cached_data.extraction_method = extracted_data["method"]
            else:
                logger.info(f"Criando nova entrada no cache para a URL: {url}")
                web_data = WebData(
                    url=url,
                    title=extracted_data['data'].get('title', ''),
                    content=extracted_data['data'].get('summary', ''),
                    extracted_data=json.dumps(extracted_data['data']),
                    extraction_method=extracted_data['method']
                )
                db.session.add(web_data)
            
            db.session.commit()
            logger.info(f"Cache salvo com sucesso para a URL: {url}")
        else:
            logger.warning(f"Falha na extração para a URL: {url}. Detalhes: {extracted_data.get('error')}")
        
        return extracted_data
        
    except Exception as e:
        logger.error(f"Erro catastrófico ao extrair e cachear dados de {url}: {e}", exc_info=True)
        return {'success': False, 'error': str(e)}



