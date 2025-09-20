import os
import sys
# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory, jsonify, request
from flask_cors import CORS
from src.database.db_instance import db
from src.routes.user import user_bp
from src.routes.chatbot import chatbot_bp
from src.routes.chatbot_enhanced import chatbot_enhanced_bp
import logging
from datetime import datetime

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'))
app.config['SECRET_KEY'] = 'asdf#FGSgvasgf$5$WGT'

# Habilita CORS para todas as rotas
CORS(app, origins="*")

# Registra blueprints
app.register_blueprint(user_bp, url_prefix='/api')
app.register_blueprint(chatbot_bp, url_prefix='/api/chatbot')
app.register_blueprint(chatbot_enhanced_bp, url_prefix='/api/chatbot/enhanced')

# Configuração do banco de dados
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(os.path.dirname(__file__), 'database', 'app.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)

# Importa modelos do chatbot após configurar o app
from src.models.chatbot import Conversation, WebData, KnowledgeBase

with app.app_context():
    db.create_all()
    logger.info("Banco de dados inicializado")

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    """Serve arquivos estáticos e SPA"""
    static_folder_path = app.static_folder
    if static_folder_path is None:
        return "Static folder not configured", 404

    if path != "" and os.path.exists(os.path.join(static_folder_path, path)):
        return send_from_directory(static_folder_path, path)
    else:
        index_path = os.path.join(static_folder_path, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(static_folder_path, 'index.html')
        else:
            return "index.html not found", 404

@app.route('/api/chat', methods=['POST'])
def chat():
    """Endpoint de chat para compatibilidade com frontend"""
    try:
        from src.services.ai_engine import AIConversationEngine
        
        data = request.get_json()
        
        if not data or 'message' not in data:
            return jsonify({'error': 'Mensagem é obrigatória'}), 400
        
        user_message = data['message'].strip()
        page_data = data.get('pageData', {})
        robot_name = data.get('robotName', 'Assistente IA')
        conversation_id = data.get('conversationId', 'default')
        
        # Extrai instruções personalizadas dos dados da página se disponível
        custom_instructions = page_data.get('custom_instructions', '') if page_data else ''
        
        if not user_message:
            return jsonify({'error': 'Mensagem não pode estar vazia'}), 400
        
        ai_engine = AIConversationEngine()
        
        # Recupera contexto da conversa
        conversation_context = ai_engine.get_conversation_context(conversation_id)
        
        # Gera resposta usando IA com instruções personalizadas
        bot_response = ai_engine.generate_persuasive_response(
            user_message, 
            conversation_context, 
            page_data,
            custom_instructions
        )
        
        # Atualiza histórico na memória
        ai_engine.update_conversation_history(
            conversation_id, user_message, bot_response, conversation_context
        )
        
        return jsonify({
            'success': True,
            'response': bot_response,
            'conversation_id': conversation_id,
            'timestamp': datetime.utcnow().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Erro no chat: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor',
            'response': 'Desculpe, ocorreu um erro. Pode tentar novamente?'
        }), 500

@app.route('/extract', methods=['POST'])
def extract_data():
    """Endpoint para extrair dados de uma URL (compatibilidade com frontend)"""
    try:
        from src.services.web_extractor import UniversalWebExtractor
        
        data = request.get_json()
        
        if not data or 'url' not in data:
            return jsonify({'error': 'URL é obrigatória'}), 400
        
        url = data['url'].strip()
        custom_instructions = data.get('instructions', '')  # Captura instruções personalizadas
        
        if not url:
            return jsonify({'error': 'URL não pode estar vazia'}), 400
        
        web_extractor = UniversalWebExtractor()
        extracted_data = web_extractor.extract_data(url)
        
        if extracted_data['success']:
            # Adiciona instruções personalizadas aos dados extraídos se fornecidas
            if custom_instructions:
                extracted_data['data']['custom_instructions'] = custom_instructions
            
            # Gera resumo de até 100 caracteres
            content = extracted_data['data'].get('clean_text', '') or extracted_data['data'].get('summary', '')
            if content:
                summary = content[:100] + '...' if len(content) > 100 else content
                extracted_data['data']['summary'] = summary
            
            return jsonify({
                'success': True,
                'data': extracted_data['data']
            })
        else:
            return jsonify({
                'success': False,
                'error': extracted_data.get('error', 'Erro na extração')
            }), 400
            
    except Exception as e:
        logger.error(f"Erro na extração de dados: {e}")
        return jsonify({
            'success': False,
            'error': 'Erro interno do servidor'
        }), 500

@app.route('/api/health', methods=['GET'])
def health_check():
    """Endpoint de health check"""
    try:
        # Verifica conexão com banco
        db.session.execute('SELECT 1')
        
        return jsonify({
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'version': 'enhanced_v6.1',
            'services': {
                'database': 'connected',
                'ai_engine': 'operational',
                'knowledge_base': 'operational',
                'web_extractor': 'operational'
            }
        })
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'timestamp': datetime.utcnow().isoformat(),
            'error': str(e)
        }), 500

@app.route('/api/version', methods=['GET'])
def get_version():
    """Retorna informações da versão"""
    return jsonify({
        'version': 'enhanced_v6.1',
        'name': 'LinkMágico Chatbot Enhanced',
        'description': 'Chatbot de vendas com IA avançada e inteligência contextual',
        'features': [
            'Conversação adaptativa baseada em estágios',
            'Análise de intenção multi-dimensional',
            'Base de conhecimento semântica',
            'Personalização de perfil do usuário',
            'Extração inteligente de dados web',
            'Analytics avançadas de conversão',
            'Técnicas de persuasão dinâmicas'
        ],
        'endpoints': {
            'enhanced_chat': '/api/chatbot/enhanced/chat',
            'knowledge_search': '/api/chatbot/enhanced/knowledge-base/search',
            'analytics': '/api/chatbot/enhanced/analytics/enhanced',
            'user_profile': '/api/chatbot/enhanced/user-profile/{session_id}'
        }
    })

@app.errorhandler(404)
def not_found(error):
    """Handler para 404"""
    return jsonify({
        'error': 'Endpoint não encontrado',
        'message': 'Verifique a URL e tente novamente'
    }), 404

@app.errorhandler(500)
def internal_error(error):
    """Handler para 500"""
    logger.error(f"Erro interno: {error}")
    return jsonify({
        'error': 'Erro interno do servidor',
        'message': 'Ocorreu um erro inesperado. Tente novamente em alguns instantes.'
    }), 500

@app.before_request
def log_request_info():
    """Log de requisições para debug"""
    if request.endpoint and not request.endpoint.startswith('static'):
        logger.info(f"{request.method} {request.path} - {request.remote_addr}")

@app.after_request
def after_request(response):
    """Adiciona headers de segurança"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    return response

if __name__ == '__main__':
    logger.info("Iniciando LinkMágico Chatbot Enhanced v6.1")
    logger.info("Recursos disponíveis:")
    logger.info("- Chat aprimorado: /api/chatbot/enhanced/chat")
    logger.info("- Base de conhecimento: /api/chatbot/enhanced/knowledge-base/search")
    logger.info("- Analytics: /api/chatbot/enhanced/analytics/enhanced")
    logger.info("- Health check: /api/health")
    
    app.run(host='0.0.0.0', port=5000, debug=True)

