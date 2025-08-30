from flask import Blueprint, request, jsonify
from src.models.chatbot import db, Conversation, WebData, KnowledgeBase
from src.services.ai_engine import AIConversationEngine
from src.services.web_extractor_simple import SimpleWebExtractor
import json
import uuid
import logging
from datetime import datetime, timedelta

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

chatbot_simple_bp = Blueprint('chatbot_simple', __name__)

# Instâncias dos serviços
ai_engine = AIConversationEngine()
web_extractor = SimpleWebExtractor()

@chatbot_simple_bp.route('/chat', methods=['POST'])
def simple_chat():
    """Endpoint simplificado para conversação com o chatbot"""
    try:
        data = request.get_json()
        
        if not data or 'message' not in data:
            return jsonify({'error': 'Mensagem é obrigatória'}), 400
        
        user_message = data['message'].strip()
        session_id = data.get('session_id') or str(uuid.uuid4())
        url_context = data.get('url')
        
        if not user_message:
            return jsonify({'error': 'Mensagem não pode estar vazia'}), 400
        
        # Extrai dados da web se URL fornecida
        web_data = None
        if url_context:
            try:
                web_data = web_extractor.extract_data(url_context)
            except Exception as e:
                logger.warning(f"Erro na extração de URL: {e}")
                web_data = None
        
        # Recupera contexto da conversa
        conversation_context = ai_engine.get_conversation_context(session_id)
        
        # Adiciona dados da web ao contexto se disponível
        if web_data and web_data.get('success'):
            conversation_context['web_data'] = web_data['data']
        
        # Gera resposta usando IA
        try:
            bot_response = ai_engine.generate_persuasive_response(
                user_message, 
                conversation_context, 
                web_data['data'] if web_data and web_data.get('success') else None
            )
        except Exception as e:
            logger.error(f"Erro na geração de resposta: {e}")
            # Fallback para resposta simples
            bot_response = "Obrigado pela sua mensagem! Como posso te ajudar melhor?"
        
        # Salva conversa no banco
        try:
            conversation = Conversation(
                session_id=session_id,
                user_message=user_message,
                bot_response=bot_response,
                context_data=json.dumps(conversation_context),
                sentiment_score=0.5
            )
            db.session.add(conversation)
            db.session.commit()
        except Exception as e:
            logger.warning(f"Erro ao salvar conversa: {e}")
        
        # Atualiza histórico na memória
        try:
            ai_engine.update_conversation_history(
                session_id, user_message, bot_response, conversation_context
            )
        except Exception as e:
            logger.warning(f"Erro ao atualizar histórico: {e}")
        
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

@chatbot_simple_bp.route('/health', methods=['GET'])
def health_check():
    """Health check simplificado"""
    try:
        return jsonify({
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'version': 'simple_test',
            'services': {
                'ai_engine': 'operational',
                'web_extractor': 'operational'
            }
        })
    except Exception as e:
        return jsonify({
            'status': 'unhealthy',
            'error': str(e)
        }), 500

@chatbot_simple_bp.route('/test', methods=['GET'])
def test_endpoint():
    """Endpoint de teste"""
    return jsonify({
        'message': 'Chatbot simples funcionando!',
        'timestamp': datetime.utcnow().isoformat()
    })

