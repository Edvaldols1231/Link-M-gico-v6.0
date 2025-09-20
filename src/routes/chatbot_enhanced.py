from flask import Blueprint, request, jsonify, session
from src.database.db_instance import db
from src.models.chatbot import Conversation, WebData, KnowledgeBase
from src.services.ai_engine_enhanced import EnhancedAIConversationEngine, ConversationStage, EmotionalState
from src.services.knowledge_base_enhanced import EnhancedKnowledgeBase, KnowledgeCategory, KnowledgeItem
from src.services.web_extractor import UniversalWebExtractor
import json
import uuid
import logging
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

chatbot_enhanced_bp = Blueprint('chatbot_enhanced', __name__)

# Instâncias dos serviços aprimorados
ai_engine = EnhancedAIConversationEngine()
knowledge_base = EnhancedKnowledgeBase()
web_extractor = UniversalWebExtractor()

@chatbot_enhanced_bp.route('/chat', methods=['POST'])
def enhanced_chat():
    """Endpoint principal para conversação com o chatbot aprimorado"""
    try:
        data = request.get_json()
        
        if not data or 'message' not in data:
            return jsonify({'error': 'Mensagem é obrigatória'}), 400
        
        user_message = data['message'].strip()
        session_id = data.get('session_id') or str(uuid.uuid4())
        url_context = data.get('url')  # URL para extração de contexto
        user_profile_data = data.get('user_profile', {})  # Dados do perfil do usuário
        
        if not user_message:
            return jsonify({'error': 'Mensagem não pode estar vazia'}), 400
        
        # Obtém ou cria contexto de conversa
        conversation_context = ai_engine.get_or_create_context(session_id)
        
        # Atualiza perfil do usuário se fornecido
        if user_profile_data:
            for key, value in user_profile_data.items():
                if hasattr(conversation_context.user_profile, key):
                    setattr(conversation_context.user_profile, key, value)
        
        # Extrai dados da web se URL fornecida
        web_data = None
        if url_context:
            web_data = extract_and_cache_web_data(url_context)
            if web_data and web_data.get('success'):
                conversation_context.web_data = web_data['data']
        
        # Busca conhecimento relevante
        relevant_knowledge = search_relevant_knowledge(user_message, conversation_context)
        
        # Gera resposta usando IA aprimorada
        try:
            # Como não temos async real, simulamos com sync
            bot_response = asyncio.run(ai_engine.generate_adaptive_response(
                user_message, 
                conversation_context,
                web_data['data'] if web_data and web_data.get('success') else None
            ))
        except Exception as e:
            logger.error(f"Erro na geração de resposta: {e}")
            # Fallback para resposta simples
            bot_response = ai_engine._get_intelligent_fallback(conversation_context, user_message)
        
        # Enriquece resposta com conhecimento relevante se apropriado
        if relevant_knowledge and should_include_knowledge(conversation_context, relevant_knowledge):
            bot_response = enrich_response_with_knowledge(bot_response, relevant_knowledge)
        
        # Calcula métricas da conversa
        conversation_metrics = calculate_conversation_metrics(conversation_context, user_message, bot_response)
        
        # Salva conversa no banco com dados aprimorados
        conversation = Conversation(
            session_id=session_id,
            user_message=user_message,
            bot_response=bot_response,
            context_data=json.dumps({
                'stage': conversation_context.current_stage.value,
                'emotional_state': conversation_context.emotional_state.value,
                'user_profile': conversation_context.user_profile.__dict__,
                'metrics': conversation_metrics,
                'knowledge_used': [item.id for item in relevant_knowledge] if relevant_knowledge else []
            }),
            sentiment_score=conversation_metrics.get('sentiment_score', 0.0)
        )
        db.session.add(conversation)
        db.session.commit()
        
        # Atualiza estatísticas de uso do conhecimento
        if relevant_knowledge:
            for item in relevant_knowledge:
                knowledge_base.update_usage_stats(item.id, was_helpful=True)
        
        return jsonify({
            'success': True,
            'response': bot_response,
            'session_id': session_id,
            'timestamp': datetime.utcnow().isoformat(),
            'conversation_context': {
                'stage': conversation_context.current_stage.value,
                'emotional_state': conversation_context.emotional_state.value,
                'engagement_level': conversation_context.user_profile.engagement_level,
                'trust_level': conversation_context.user_profile.trust_level,
                'purchase_readiness': conversation_context.user_profile.purchase_readiness
            },
            'metrics': conversation_metrics,
            'has_web_context': web_data is not None and web_data.get('success', False),
            'knowledge_items_used': len(relevant_knowledge) if relevant_knowledge else 0
        })
        
    except Exception as e:
        logger.error(f"Erro no chat aprimorado: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor',
            'response': 'Desculpe, ocorreu um erro. Pode tentar novamente?'
        }), 500

@chatbot_enhanced_bp.route('/extract-url', methods=['POST'])
def enhanced_extract_url():
    """Endpoint aprimorado para extrair dados de uma URL"""
    try:
        data = request.get_json()
        
        if not data or 'url' not in data:
            return jsonify({'error': 'URL é obrigatória'}), 400
        
        url = data['url'].strip()
        method = data.get('method', 'auto')
        force_refresh = data.get('force_refresh', False)
        extract_for_sales = data.get('extract_for_sales', True)  # Foco em dados de vendas
        
        if not url:
            return jsonify({'error': 'URL não pode estar vazia'}), 400
        
        # Verifica cache
        if not force_refresh:
            cached_data = WebData.query.filter_by(url=url).first()
            if cached_data and (datetime.utcnow() - cached_data.last_updated) < timedelta(hours=12):
                extracted_data = json.loads(cached_data.extracted_data)
                
                # Enriquece dados para vendas se solicitado
                if extract_for_sales:
                    extracted_data = enrich_data_for_sales(extracted_data)
                
                return jsonify({
                    'success': True,
                    'data': extracted_data,
                    'cached': True,
                    'cache_age_hours': (datetime.utcnow() - cached_data.last_updated).total_seconds() / 3600
                })
        
        # Extrai dados
        extracted_data = web_extractor.extract_data(url, method)
        
        if extracted_data['success']:
            # Enriquece dados para vendas
            if extract_for_sales:
                extracted_data['data'] = enrich_data_for_sales(extracted_data['data'])
            
            # Salva ou atualiza no banco
            web_data = WebData.query.filter_by(url=url).first()
            if web_data:
                web_data.title = extracted_data['data'].get('title', '')
                web_data.content = extracted_data['data'].get('clean_text', '')[:15000]  # Aumentado limite
                web_data.extracted_data = json.dumps(extracted_data['data'])
                web_data.last_updated = datetime.utcnow()
                web_data.extraction_method = extracted_data['method']
            else:
                web_data = WebData(
                    url=url,
                    title=extracted_data['data'].get('title', ''),
                    content=extracted_data['data'].get('clean_text', '')[:15000],
                    extracted_data=json.dumps(extracted_data['data']),
                    extraction_method=extracted_data['method']
                )
                db.session.add(web_data)
            
            db.session.commit()
            
            return jsonify({
                'success': True,
                'data': extracted_data,
                'cached': False,
                'sales_insights': extract_sales_insights(extracted_data['data'])
            })
        else:
            return jsonify({
                'success': False,
                'error': extracted_data.get('error', 'Erro na extração'),
                'data': extracted_data
            }), 400
            
    except Exception as e:
        logger.error(f"Erro na extração aprimorada de URL: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500

@chatbot_enhanced_bp.route('/knowledge-base/search', methods=['POST'])
def search_knowledge():
    """Busca inteligente na base de conhecimento"""
    try:
        data = request.get_json()
        
        if not data or 'query' not in data:
            return jsonify({'error': 'Query é obrigatória'}), 400
        
        query = data['query'].strip()
        category = data.get('category')
        context_tags = data.get('context_tags', [])
        max_results = data.get('max_results', 5)
        
        if not query:
            return jsonify({'error': 'Query não pode estar vazia'}), 400
        
        # Converte categoria se fornecida
        knowledge_category = None
        if category:
            try:
                knowledge_category = KnowledgeCategory(category)
            except ValueError:
                return jsonify({'error': f'Categoria inválida: {category}'}), 400
        
        # Busca na base de conhecimento
        search_results = knowledge_base.search(
            query=query,
            category=knowledge_category,
            context_tags=context_tags,
            max_results=max_results
        )
        
        # Formata resultados
        formatted_results = []
        for result in search_results:
            formatted_results.append({
                'id': result.item.id,
                'title': result.item.title,
                'content': result.item.content,
                'category': result.item.category.value,
                'keywords': result.item.keywords,
                'context_tags': result.item.context_tags,
                'relevance_score': result.relevance_score,
                'match_type': result.match_type,
                'matched_keywords': result.matched_keywords,
                'priority': result.item.priority,
                'effectiveness_score': result.item.effectiveness_score
            })
        
        return jsonify({
            'success': True,
            'query': query,
            'results': formatted_results,
            'total_found': len(formatted_results)
        })
        
    except Exception as e:
        logger.error(f"Erro na busca de conhecimento: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500

@chatbot_enhanced_bp.route('/knowledge-base/add', methods=['POST'])
def add_knowledge():
    """Adiciona item à base de conhecimento"""
    try:
        data = request.get_json()
        
        required_fields = ['category', 'title', 'content', 'keywords']
        if not all(field in data for field in required_fields):
            return jsonify({'error': f'Campos obrigatórios: {", ".join(required_fields)}'}), 400
        
        # Valida categoria
        try:
            category = KnowledgeCategory(data['category'])
        except ValueError:
            return jsonify({'error': f'Categoria inválida: {data["category"]}'}), 400
        
        # Cria item de conhecimento
        knowledge_item = KnowledgeItem(
            id="",  # Será gerado automaticamente
            category=category,
            title=data['title'],
            content=data['content'],
            keywords=data['keywords'] if isinstance(data['keywords'], list) else [data['keywords']],
            context_tags=data.get('context_tags', []),
            priority=data.get('priority', 5),
            confidence_score=data.get('confidence_score', 0.8),
            source=data.get('source', 'manual_input')
        )
        
        # Adiciona à base de conhecimento
        item_id = knowledge_base.add_knowledge_item(knowledge_item)
        
        # Também adiciona ao banco de dados tradicional para compatibilidade
        db_knowledge = KnowledgeBase(
            category=data['category'],
            keyword=', '.join(knowledge_item.keywords),
            content=knowledge_item.content,
            priority=knowledge_item.priority
        )
        db.session.add(db_knowledge)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'item_id': item_id,
            'message': 'Item adicionado com sucesso à base de conhecimento'
        }), 201
        
    except Exception as e:
        logger.error(f"Erro ao adicionar conhecimento: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500

@chatbot_enhanced_bp.route('/analytics/enhanced', methods=['GET'])
def get_enhanced_analytics():
    """Retorna analytics avançadas do chatbot"""
    try:
        # Analytics básicas
        total_conversations = Conversation.query.count()
        yesterday = datetime.utcnow() - timedelta(days=1)
        recent_conversations = Conversation.query.filter(Conversation.timestamp >= yesterday).count()
        unique_sessions = db.session.query(Conversation.session_id).distinct().count()
        
        # Analytics de estágios de conversa
        stage_analytics = analyze_conversation_stages()
        
        # Analytics de conhecimento
        knowledge_stats = knowledge_base.get_stats()
        
        # Analytics de sentimento
        sentiment_analytics = analyze_sentiment_trends()
        
        # Analytics de conversão
        conversion_analytics = analyze_conversion_metrics()
        
        return jsonify({
            'success': True,
            'analytics': {
                'basic': {
                    'total_conversations': total_conversations,
                    'recent_conversations': recent_conversations,
                    'unique_sessions': unique_sessions
                },
                'conversation_stages': stage_analytics,
                'knowledge_base': knowledge_stats,
                'sentiment_trends': sentiment_analytics,
                'conversion_metrics': conversion_analytics
            }
        })
        
    except Exception as e:
        logger.error(f"Erro ao recuperar analytics aprimoradas: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500

@chatbot_enhanced_bp.route('/user-profile/<session_id>', methods=['GET', 'PUT'])
def manage_user_profile(session_id):
    """Gerencia perfil do usuário"""
    if request.method == 'GET':
        try:
            context = ai_engine.conversation_contexts.get(session_id)
            if not context:
                return jsonify({
                    'success': False,
                    'error': 'Sessão não encontrada'
                }), 404
            
            profile = context.user_profile
            return jsonify({
                'success': True,
                'profile': {
                    'session_id': profile.session_id,
                    'name': profile.name,
                    'interests': profile.interests,
                    'pain_points': profile.pain_points,
                    'budget_range': profile.budget_range,
                    'decision_timeline': profile.decision_timeline,
                    'communication_style': profile.communication_style,
                    'engagement_level': profile.engagement_level,
                    'trust_level': profile.trust_level,
                    'purchase_readiness': profile.purchase_readiness
                }
            })
            
        except Exception as e:
            logger.error(f"Erro ao recuperar perfil: {e}")
            return jsonify({
                'success': False,
                'error': 'Erro interno do servidor'
            }), 500
    
    elif request.method == 'PUT':
        try:
            data = request.get_json()
            context = ai_engine.get_or_create_context(session_id)
            
            # Atualiza campos do perfil
            profile = context.user_profile
            for key, value in data.items():
                if hasattr(profile, key):
                    setattr(profile, key, value)
            
            return jsonify({
                'success': True,
                'message': 'Perfil atualizado com sucesso'
            })
            
        except Exception as e:
            logger.error(f"Erro ao atualizar perfil: {e}")
            return jsonify({
                'success': False,
                'error': 'Erro interno do servidor'
            }), 500

# Funções auxiliares

def search_relevant_knowledge(user_message: str, context) -> list:
    """Busca conhecimento relevante para a mensagem do usuário"""
    try:
        # Determina tags de contexto baseado no estágio da conversa
        context_tags = []
        
        if context.current_stage == ConversationStage.AWARENESS:
            context_tags = ['product_overview', 'introduction', 'capabilities']
        elif context.current_stage == ConversationStage.INTEREST:
            context_tags = ['benefits', 'features', 'value_proposition']
        elif context.current_stage == ConversationStage.CONSIDERATION:
            context_tags = ['competitive_advantage', 'social_proof', 'case_studies']
        elif context.current_stage == ConversationStage.INTENT:
            context_tags = ['pricing', 'implementation', 'next_steps']
        
        # Busca conhecimento relevante
        search_results = knowledge_base.search(
            query=user_message,
            context_tags=context_tags,
            max_results=3
        )
        
        # Filtra por relevância mínima
        relevant_items = [result.item for result in search_results if result.relevance_score > 0.3]
        
        return relevant_items
        
    except Exception as e:
        logger.error(f"Erro ao buscar conhecimento relevante: {e}")
        return []

def should_include_knowledge(context, knowledge_items: list) -> bool:
    """Determina se deve incluir conhecimento na resposta"""
    # Inclui conhecimento se:
    # 1. Usuário está em estágio inicial e precisa de informações
    # 2. Nível de confiança é baixo e precisa de prova social
    # 3. Há objeções que podem ser tratadas com conhecimento
    
    if context.current_stage in [ConversationStage.AWARENESS, ConversationStage.INTEREST]:
        return True
    
    if context.user_profile.trust_level < 0.6:
        return True
    
    if any(item.category in [KnowledgeCategory.OBJECTION_HANDLING, KnowledgeCategory.TESTIMONIALS] 
           for item in knowledge_items):
        return True
    
    return False

def enrich_response_with_knowledge(response: str, knowledge_items: list) -> str:
    """Enriquece resposta com conhecimento relevante"""
    if not knowledge_items:
        return response
    
    # Adiciona conhecimento de forma natural
    enriched_response = response
    
    for item in knowledge_items[:2]:  # Máximo 2 itens para não sobrecarregar
        if item.category == KnowledgeCategory.CUSTOMER_STORIES:
            enriched_response += f"\n\n📈 {item.content[:200]}..."
        elif item.category == KnowledgeCategory.TESTIMONIALS:
            enriched_response += f"\n\n💬 {item.content[:150]}..."
        elif item.category == KnowledgeCategory.FAQS:
            enriched_response += f"\n\n❓ {item.title}: {item.content[:200]}..."
    
    return enriched_response

def calculate_conversation_metrics(context, user_message: str, bot_response: str) -> Dict[str, Any]:
    """Calcula métricas da conversa"""
    metrics = {
        'message_length': len(user_message),
        'response_length': len(bot_response),
        'engagement_score': context.user_profile.engagement_level,
        'trust_score': context.user_profile.trust_level,
        'purchase_readiness': context.user_profile.purchase_readiness,
        'conversation_stage': context.current_stage.value,
        'emotional_state': context.emotional_state.value,
        'interaction_count': len(context.conversation_history),
        'sentiment_score': 0.5  # Placeholder - implementar análise real
    }
    
    return metrics

def enrich_data_for_sales(data: Dict) -> Dict:
    """Enriquece dados extraídos com foco em vendas"""
    enriched = data.copy()
    
    # Extrai informações específicas para vendas
    sales_info = {
        'value_propositions': extract_value_propositions(data),
        'pricing_info': extract_pricing_info(data),
        'social_proof': extract_social_proof(data),
        'contact_methods': extract_contact_methods(data),
        'urgency_indicators': extract_urgency_indicators(data)
    }
    
    enriched['sales_insights'] = sales_info
    return enriched

def extract_sales_insights(data: Dict) -> Dict:
    """Extrai insights específicos para vendas"""
    insights = {
        'has_pricing': bool(data.get('ecommerce', {}).get('prices')),
        'has_testimonials': bool(data.get('ecommerce', {}).get('reviews')),
        'has_contact_info': bool(data.get('contact_info', {}).get('emails') or data.get('contact_info', {}).get('phones')),
        'page_type': classify_page_type(data),
        'conversion_elements': identify_conversion_elements(data)
    }
    
    return insights

def extract_value_propositions(data: Dict) -> list:
    """Extrai propostas de valor do conteúdo"""
    # Implementação simplificada - pode ser expandida
    headings = data.get('headings', {})
    value_props = []
    
    for heading_level, texts in headings.items():
        for text in texts:
            if any(keyword in text.lower() for keyword in ['benefício', 'vantagem', 'solução', 'resultado']):
                value_props.append(text)
    
    return value_props[:5]  # Máximo 5

def extract_pricing_info(data: Dict) -> Dict:
    """Extrai informações de preço"""
    ecommerce = data.get('ecommerce', {})
    prices = ecommerce.get('prices', [])
    
    return {
        'has_pricing': len(prices) > 0,
        'price_count': len(prices),
        'prices': prices[:3]  # Primeiros 3 preços
    }

def extract_social_proof(data: Dict) -> Dict:
    """Extrai prova social"""
    ecommerce = data.get('ecommerce', {})
    reviews = ecommerce.get('reviews', [])
    
    return {
        'has_reviews': len(reviews) > 0,
        'review_count': len(reviews),
        'sample_reviews': reviews[:2]  # Primeiras 2 reviews
    }

def extract_contact_methods(data: Dict) -> Dict:
    """Extrai métodos de contato"""
    contact_info = data.get('contact_info', {})
    
    return {
        'emails': contact_info.get('emails', []),
        'phones': contact_info.get('phones', []),
        'has_contact': bool(contact_info.get('emails') or contact_info.get('phones'))
    }

def extract_urgency_indicators(data: Dict) -> list:
    """Extrai indicadores de urgência"""
    content = data.get('clean_text', '').lower()
    urgency_keywords = ['limitado', 'oferta', 'desconto', 'prazo', 'últimas', 'apenas', 'hoje']
    
    indicators = []
    for keyword in urgency_keywords:
        if keyword in content:
            indicators.append(keyword)
    
    return indicators

def classify_page_type(data: Dict) -> str:
    """Classifica o tipo de página"""
    title = data.get('title', '').lower()
    content = data.get('clean_text', '').lower()
    
    if any(keyword in title or keyword in content for keyword in ['produto', 'comprar', 'preço']):
        return 'product_page'
    elif any(keyword in title or keyword in content for keyword in ['sobre', 'empresa', 'quem somos']):
        return 'about_page'
    elif any(keyword in title or keyword in content for keyword in ['contato', 'fale conosco']):
        return 'contact_page'
    elif any(keyword in title or keyword in content for keyword in ['blog', 'artigo', 'notícia']):
        return 'content_page'
    else:
        return 'landing_page'

def identify_conversion_elements(data: Dict) -> list:
    """Identifica elementos de conversão"""
    elements = []
    
    # Verifica formulários
    forms = data.get('forms', [])
    if forms:
        elements.append('contact_form')
    
    # Verifica botões de ação
    links = data.get('links', [])
    for link in links:
        link_text = link.get('text', '').lower()
        if any(keyword in link_text for keyword in ['comprar', 'adquirir', 'solicitar', 'contato']):
            elements.append('cta_button')
            break
    
    # Verifica informações de preço
    if data.get('ecommerce', {}).get('prices'):
        elements.append('pricing_info')
    
    # Verifica depoimentos
    if data.get('ecommerce', {}).get('reviews'):
        elements.append('testimonials')
    
    return list(set(elements))

def analyze_conversation_stages() -> Dict:
    """Analisa distribuição de estágios de conversa"""
    try:
        # Busca conversas recentes com dados de contexto
        recent_conversations = Conversation.query.filter(
            Conversation.timestamp >= datetime.utcnow() - timedelta(days=7)
        ).all()
        
        stage_counts = {}
        for conv in recent_conversations:
            try:
                context_data = json.loads(conv.context_data) if conv.context_data else {}
                stage = context_data.get('stage', 'unknown')
                stage_counts[stage] = stage_counts.get(stage, 0) + 1
            except:
                continue
        
        return stage_counts
        
    except Exception as e:
        logger.error(f"Erro ao analisar estágios: {e}")
        return {}

def analyze_sentiment_trends() -> Dict:
    """Analisa tendências de sentimento"""
    try:
        # Busca conversas recentes
        recent_conversations = Conversation.query.filter(
            Conversation.timestamp >= datetime.utcnow() - timedelta(days=7)
        ).all()
        
        sentiments = [conv.sentiment_score for conv in recent_conversations if conv.sentiment_score is not None]
        
        if not sentiments:
            return {'average': 0.0, 'trend': 'neutral'}
        
        avg_sentiment = sum(sentiments) / len(sentiments)
        
        return {
            'average': avg_sentiment,
            'total_analyzed': len(sentiments),
            'trend': 'positive' if avg_sentiment > 0.6 else 'negative' if avg_sentiment < 0.4 else 'neutral'
        }
        
    except Exception as e:
        logger.error(f"Erro ao analisar sentimento: {e}")
        return {'average': 0.0, 'trend': 'neutral'}

def analyze_conversion_metrics() -> Dict:
    """Analisa métricas de conversão"""
    try:
        # Busca conversas com dados de contexto
        conversations = Conversation.query.filter(
            Conversation.timestamp >= datetime.utcnow() - timedelta(days=30)
        ).all()
        
        total_sessions = len(set(conv.session_id for conv in conversations))
        high_readiness_sessions = 0
        
        for conv in conversations:
            try:
                context_data = json.loads(conv.context_data) if conv.context_data else {}
                metrics = context_data.get('metrics', {})
                if metrics.get('purchase_readiness', 0) > 0.7:
                    high_readiness_sessions += 1
            except:
                continue
        
        conversion_rate = (high_readiness_sessions / total_sessions * 100) if total_sessions > 0 else 0
        
        return {
            'total_sessions': total_sessions,
            'high_readiness_sessions': high_readiness_sessions,
            'conversion_rate': round(conversion_rate, 2)
        }
        
    except Exception as e:
        logger.error(f"Erro ao analisar conversão: {e}")
        return {'total_sessions': 0, 'conversion_rate': 0}

def extract_and_cache_web_data(url: str) -> dict:
    """Função auxiliar aprimorada para extrair e cachear dados da web"""
    try:
        # Verifica cache primeiro (tempo reduzido para dados mais frescos)
        cached_data = WebData.query.filter_by(url=url).first()
        if cached_data and (datetime.utcnow() - cached_data.last_updated) < timedelta(hours=6):
            extracted_data = json.loads(cached_data.extracted_data)
            return {
                'success': True,
                'data': enrich_data_for_sales(extracted_data),
                'cached': True
            }
        
        # Extrai dados
        extracted_data = web_extractor.extract_data(url)
        
        if extracted_data['success']:
            # Enriquece dados para vendas
            extracted_data['data'] = enrich_data_for_sales(extracted_data['data'])
            
            # Salva no cache
            if cached_data:
                cached_data.title = extracted_data['data'].get('title', '')
                cached_data.content = extracted_data['data'].get('clean_text', '')[:15000]
                cached_data.extracted_data = json.dumps(extracted_data['data'])
                cached_data.last_updated = datetime.utcnow()
                cached_data.extraction_method = extracted_data['method']
            else:
                web_data = WebData(
                    url=url,
                    title=extracted_data['data'].get('title', ''),
                    content=extracted_data['data'].get('clean_text', '')[:15000],
                    extracted_data=json.dumps(extracted_data['data']),
                    extraction_method=extracted_data['method']
                )
                db.session.add(web_data)
            
            db.session.commit()
        
        return extracted_data
        
    except Exception as e:
        logger.error(f"Erro ao extrair e cachear dados de {url}: {e}")
        return {'success': False, 'error': str(e)}

