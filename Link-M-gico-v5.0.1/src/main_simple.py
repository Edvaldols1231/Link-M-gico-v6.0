import os
import sys
# DON'T CHANGE THIS !!!
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from flask import Flask, send_from_directory, jsonify
from flask_cors import CORS
from src.models.user import db
from src.routes.chatbot_simple import chatbot_simple_bp
import logging
from datetime import datetime

# Configurar logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'))
app.config['SECRET_KEY'] = 'test_secret_key'

# Habilita CORS para todas as rotas
CORS(app, origins="*")

# Registra blueprint simplificado
app.register_blueprint(chatbot_simple_bp, url_prefix='/api/chatbot')

# Configuração do banco de dados
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(os.path.dirname(__file__), 'database', 'app.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)

# Importa modelos do chatbot após configurar o app
from src.models.chatbot import Conversation, WebData, KnowledgeBase

with app.app_context():
    db.create_all()
    logger.info("Banco de dados inicializado")

@app.route('/')
def home():
    """Página inicial"""
    return jsonify({
        'message': 'LinkMágico Chatbot - Versão de Teste',
        'version': 'simple_test',
        'endpoints': {
            'chat': '/api/chatbot/chat',
            'health': '/api/chatbot/health',
            'test': '/api/chatbot/test'
        }
    })

@app.route('/api/health', methods=['GET'])
def health_check():
    """Endpoint de health check"""
    try:
        # Verifica conexão com banco
        db.session.execute('SELECT 1')
        
        return jsonify({
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'version': 'simple_test'
        })
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'timestamp': datetime.utcnow().isoformat(),
            'error': str(e)
        }), 500

if __name__ == '__main__':
    logger.info("Iniciando LinkMágico Chatbot - Versão de Teste")
    logger.info("Endpoints disponíveis:")
    logger.info("- Chat: /api/chatbot/chat")
    logger.info("- Health: /api/health")
    logger.info("- Test: /api/chatbot/test")
    
    app.run(host='0.0.0.0', port=5000, debug=True)

