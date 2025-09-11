from src.database.db_instance import db
from datetime import datetime
import json

class Conversation(db.Model):
    """Modelo para armazenar conversas do chatbot"""
    id = db.Column(db.Integer, primary_key=True)
    session_id = db.Column(db.String(100), nullable=False, index=True)
    user_message = db.Column(db.Text, nullable=False)
    bot_response = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    context_data = db.Column(db.Text)  # JSON string para contexto adicional
    sentiment_score = db.Column(db.Float, default=0.0)
    
    def to_dict(self):
        return {
            'id': self.id,
            'session_id': self.session_id,
            'user_message': self.user_message,
            'bot_response': self.bot_response,
            'timestamp': self.timestamp.isoformat(),
            'context_data': json.loads(self.context_data) if self.context_data else {},
            'sentiment_score': self.sentiment_score
        }

class WebData(db.Model):
    """Modelo para armazenar dados extraídos da web"""
    id = db.Column(db.Integer, primary_key=True)
    url = db.Column(db.String(500), nullable=False, unique=True)
    title = db.Column(db.String(200))
    content = db.Column(db.Text)
    extracted_data = db.Column(db.Text)  # JSON string com dados estruturados
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)
    extraction_method = db.Column(db.String(50))  # 'requests', 'selenium', 'playwright'
    
    def to_dict(self):
        return {
            'id': self.id,
            'url': self.url,
            'title': self.title,
            'content': self.content[:500] + '...' if self.content and len(self.content) > 500 else self.content,
            'extracted_data': json.loads(self.extracted_data) if self.extracted_data else {},
            'last_updated': self.last_updated.isoformat(),
            'extraction_method': self.extraction_method
        }

class KnowledgeBase(db.Model):
    """Modelo para base de conhecimento do chatbot"""
    id = db.Column(db.Integer, primary_key=True)
    category = db.Column(db.String(100), nullable=False)
    keyword = db.Column(db.String(200), nullable=False)
    content = db.Column(db.Text, nullable=False)
    priority = db.Column(db.Integer, default=1)  # 1=baixa, 5=alta
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'category': self.category,
            'keyword': self.keyword,
            'content': self.content,
            'priority': self.priority,
            'created_at': self.created_at.isoformat()
        }


