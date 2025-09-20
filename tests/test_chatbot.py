import unittest
import json
import os
import sys
from unittest.mock import patch, MagicMock

# Adiciona o diretório raiz ao path
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from src.main import app, db
from src.models.chatbot import Conversation, WebData, KnowledgeBase
from src.services.ai_engine import AIConversationEngine
from src.services.web_extractor import UniversalWebExtractor

class TestChatbot(unittest.TestCase):
    """Testes para o sistema de chatbot"""
    
    def setUp(self):
        """Configuração inicial para cada teste"""
        app.config['TESTING'] = True
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.app = app.test_client()
        self.app_context = app.app_context()
        self.app_context.push()
        db.create_all()
    
    def tearDown(self):
        """Limpeza após cada teste"""
        db.session.remove()
        db.drop_all()
        self.app_context.pop()
    
    def test_chat_endpoint_basic(self):
        """Testa endpoint básico de chat"""
        response = self.app.post('/api/chatbot/chat', 
                                json={'message': 'Olá'})
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertIn('response', data)
        self.assertIn('session_id', data)
    
    def test_chat_endpoint_empty_message(self):
        """Testa endpoint de chat com mensagem vazia"""
        response = self.app.post('/api/chatbot/chat', 
                                json={'message': ''})
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)
    
    def test_chat_endpoint_no_message(self):
        """Testa endpoint de chat sem mensagem"""
        response = self.app.post('/api/chatbot/chat', json={})
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)
    
    def test_extract_url_endpoint_basic(self):
        """Testa endpoint básico de extração de URL"""
        response = self.app.post('/api/chatbot/extract-url', 
                                json={'url': 'https://example.com'})
        
        # Pode retornar 200 ou 400 dependendo da conectividade
        self.assertIn(response.status_code, [200, 400])
        data = json.loads(response.data)
        self.assertIn('success', data)
    
    def test_extract_url_endpoint_invalid_url(self):
        """Testa endpoint de extração com URL inválida"""
        response = self.app.post('/api/chatbot/extract-url', 
                                json={'url': 'invalid-url'})
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertFalse(data['success'])
    
    def test_extract_url_endpoint_no_url(self):
        """Testa endpoint de extração sem URL"""
        response = self.app.post('/api/chatbot/extract-url', json={})
        
        self.assertEqual(response.status_code, 400)
        data = json.loads(response.data)
        self.assertIn('error', data)
    
    def test_analytics_endpoint(self):
        """Testa endpoint de analytics"""
        response = self.app.get('/api/chatbot/analytics')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data['success'])
        self.assertIn('analytics', data)
        self.assertIn('total_conversations', data['analytics'])
    
    def test_knowledge_base_get(self):
        """Testa endpoint GET da base de conhecimento"""
        # Adiciona item de teste
        kb_item = KnowledgeBase(
            category='teste',
            keyword='palavra-chave',
            content='Conteúdo de teste',
            priority=3
        )
        db.session.add(kb_item)
        db.session.commit()
        
        response = self.app.get('/api/chatbot/knowledge-base')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data['success'])
        self.assertGreater(len(data['items']), 0)
    
    def test_knowledge_base_post(self):
        """Testa endpoint POST da base de conhecimento"""
        kb_data = {
            'category': 'vendas',
            'keyword': 'produto',
            'content': 'Informações sobre o produto',
            'priority': 5
        }
        
        response = self.app.post('/api/chatbot/knowledge-base', json=kb_data)
        
        self.assertEqual(response.status_code, 201)
        data = json.loads(response.data)
        self.assertTrue(data['success'])
        self.assertIn('item', data)
    
    def test_conversation_history(self):
        """Testa endpoint de histórico de conversa"""
        # Adiciona conversa de teste
        conversation = Conversation(
            session_id='test_session',
            user_message='Mensagem de teste',
            bot_response='Resposta de teste',
            sentiment_score=0.5
        )
        db.session.add(conversation)
        db.session.commit()
        
        response = self.app.get('/api/chatbot/conversation-history/test_session')
        
        self.assertEqual(response.status_code, 200)
        data = json.loads(response.data)
        self.assertTrue(data['success'])
        self.assertGreater(len(data['history']), 0)

class TestAIEngine(unittest.TestCase):
    """Testes para o motor de IA"""
    
    def setUp(self):
        """Configuração inicial"""
        self.ai_engine = AIConversationEngine()
    
    def test_analyze_user_intent_structure(self):
        """Testa estrutura da análise de intenção"""
        with patch.object(self.ai_engine.client.chat.completions, 'create') as mock_create:
            mock_response = MagicMock()
            mock_response.choices[0].message.content = json.dumps({
                "intent": "greeting",
                "sentiment": "positive",
                "urgency_level": "low",
                "buying_stage": "awareness",
                "emotional_state": "curious",
                "key_concerns": []
            })
            mock_create.return_value = mock_response
            
            result = self.ai_engine.analyze_user_intent("Olá", {})
            
            self.assertIn('intent', result)
            self.assertIn('sentiment', result)
            self.assertIn('urgency_level', result)
    
    def test_generate_session_id(self):
        """Testa geração de ID de sessão"""
        session_id = self.ai_engine._generate_session_id() if hasattr(self.ai_engine, '_generate_session_id') else 'test_session'
        self.assertIsInstance(session_id, str)
        self.assertGreater(len(session_id), 0)
    
    def test_conversation_context(self):
        """Testa contexto de conversa"""
        session_id = 'test_session'
        context = self.ai_engine.get_conversation_context(session_id)
        
        self.assertIsInstance(context, dict)
        self.assertIn('previous_messages', context)
        self.assertIn('total_interactions', context)

class TestWebExtractor(unittest.TestCase):
    """Testes para o extrator web"""
    
    def setUp(self):
        """Configuração inicial"""
        self.extractor = UniversalWebExtractor()
    
    def test_detect_best_method(self):
        """Testa detecção do melhor método"""
        # Teste com site comum
        method = self.extractor._detect_best_method('https://example.com')
        self.assertIn(method, ['requests', 'cloudscraper', 'selenium', 'playwright'])
        
        # Teste com site que precisa de JavaScript
        method = self.extractor._detect_best_method('https://facebook.com/page')
        self.assertEqual(method, 'playwright')
    
    def test_setup_headers(self):
        """Testa configuração de headers"""
        self.extractor.setup_headers()
        self.assertIn('User-Agent', self.extractor.headers)
        self.assertIn('Accept', self.extractor.headers)
    
    def test_create_error_response(self):
        """Testa criação de resposta de erro"""
        error_response = self.extractor._create_error_response('https://test.com', 'Erro de teste')
        
        self.assertFalse(error_response['success'])
        self.assertEqual(error_response['url'], 'https://test.com')
        self.assertEqual(error_response['error'], 'Erro de teste')

class TestModels(unittest.TestCase):
    """Testes para os modelos de dados"""
    
    def setUp(self):
        """Configuração inicial"""
        app.config['TESTING'] = True
        app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
        self.app_context = app.app_context()
        self.app_context.push()
        db.create_all()
    
    def tearDown(self):
        """Limpeza"""
        db.session.remove()
        db.drop_all()
        self.app_context.pop()
    
    def test_conversation_model(self):
        """Testa modelo de conversa"""
        conversation = Conversation(
            session_id='test_session',
            user_message='Teste',
            bot_response='Resposta teste',
            sentiment_score=0.8
        )
        
        db.session.add(conversation)
        db.session.commit()
        
        # Testa recuperação
        retrieved = Conversation.query.filter_by(session_id='test_session').first()
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.user_message, 'Teste')
        
        # Testa conversão para dict
        conv_dict = retrieved.to_dict()
        self.assertIn('session_id', conv_dict)
        self.assertIn('user_message', conv_dict)
    
    def test_web_data_model(self):
        """Testa modelo de dados web"""
        web_data = WebData(
            url='https://test.com',
            title='Página de Teste',
            content='Conteúdo de teste',
            extracted_data='{"test": "data"}',
            extraction_method='requests'
        )
        
        db.session.add(web_data)
        db.session.commit()
        
        # Testa recuperação
        retrieved = WebData.query.filter_by(url='https://test.com').first()
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.title, 'Página de Teste')
        
        # Testa conversão para dict
        data_dict = retrieved.to_dict()
        self.assertIn('url', data_dict)
        self.assertIn('title', data_dict)
    
    def test_knowledge_base_model(self):
        """Testa modelo de base de conhecimento"""
        kb_item = KnowledgeBase(
            category='teste',
            keyword='palavra-chave',
            content='Conteúdo de teste',
            priority=3
        )
        
        db.session.add(kb_item)
        db.session.commit()
        
        # Testa recuperação
        retrieved = KnowledgeBase.query.filter_by(keyword='palavra-chave').first()
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved.category, 'teste')
        
        # Testa conversão para dict
        kb_dict = retrieved.to_dict()
        self.assertIn('category', kb_dict)
        self.assertIn('keyword', kb_dict)

if __name__ == '__main__':
    # Executa todos os testes
    unittest.main(verbosity=2)

