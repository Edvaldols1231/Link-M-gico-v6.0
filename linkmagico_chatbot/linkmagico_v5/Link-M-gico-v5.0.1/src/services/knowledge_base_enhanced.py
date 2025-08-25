import os
import json
import logging
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from datetime import datetime
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import pickle
import hashlib
from enum import Enum

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class KnowledgeCategory(Enum):
    """Categorias de conhecimento"""
    PRODUCT_INFO = "product_info"
    SALES_TECHNIQUES = "sales_techniques"
    OBJECTION_HANDLING = "objection_handling"
    CUSTOMER_STORIES = "customer_stories"
    PRICING = "pricing"
    FEATURES = "features"
    BENEFITS = "benefits"
    COMPARISONS = "comparisons"
    FAQS = "faqs"
    TESTIMONIALS = "testimonials"
    CASE_STUDIES = "case_studies"
    INDUSTRY_INSIGHTS = "industry_insights"

@dataclass
class KnowledgeItem:
    """Item de conhecimento estruturado"""
    id: str
    category: KnowledgeCategory
    title: str
    content: str
    keywords: List[str]
    context_tags: List[str]  # Para quando usar este conhecimento
    priority: int  # 1-10, onde 10 é mais importante
    confidence_score: float  # 0-1, quão confiável é esta informação
    source: Optional[str] = None
    created_at: datetime = None
    updated_at: datetime = None
    usage_count: int = 0
    effectiveness_score: float = 0.5  # Baseado no feedback de uso
    
    def __post_init__(self):
        if self.created_at is None:
            self.created_at = datetime.now()
        if self.updated_at is None:
            self.updated_at = datetime.now()
        if not self.id:
            self.id = self._generate_id()
    
    def _generate_id(self) -> str:
        """Gera ID único baseado no conteúdo"""
        content_hash = hashlib.md5(f"{self.title}{self.content}".encode()).hexdigest()
        return f"{self.category.value}_{content_hash[:8]}"

@dataclass
class SearchResult:
    """Resultado de busca na base de conhecimento"""
    item: KnowledgeItem
    relevance_score: float
    match_type: str  # 'exact', 'semantic', 'keyword'
    matched_keywords: List[str]

class EnhancedKnowledgeBase:
    """Sistema avançado de base de conhecimento com busca semântica"""
    
    def __init__(self, storage_path: str = "/tmp/knowledge_base"):
        self.storage_path = storage_path
        self.knowledge_items: Dict[str, KnowledgeItem] = {}
        self.vectorizer = TfidfVectorizer(
            max_features=5000,
            stop_words='english',
            ngram_range=(1, 3),
            lowercase=True
        )
        self.content_vectors = None
        self.is_vectorizer_fitted = False
        
        # Carrega dados existentes
        self._load_knowledge_base()
        self._initialize_default_knowledge()
        
        logger.info(f"Enhanced Knowledge Base inicializada com {len(self.knowledge_items)} itens")
    
    def _load_knowledge_base(self):
        """Carrega base de conhecimento do armazenamento"""
        try:
            if os.path.exists(f"{self.storage_path}/knowledge_items.json"):
                with open(f"{self.storage_path}/knowledge_items.json", 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    for item_data in data:
                        item = KnowledgeItem(**item_data)
                        item.category = KnowledgeCategory(item.category)
                        item.created_at = datetime.fromisoformat(item.created_at)
                        item.updated_at = datetime.fromisoformat(item.updated_at)
                        self.knowledge_items[item.id] = item
            
            # Carrega vetores se existirem
            if os.path.exists(f"{self.storage_path}/vectorizer.pkl"):
                with open(f"{self.storage_path}/vectorizer.pkl", 'rb') as f:
                    self.vectorizer = pickle.load(f)
                    self.is_vectorizer_fitted = True
            
            if os.path.exists(f"{self.storage_path}/content_vectors.pkl"):
                with open(f"{self.storage_path}/content_vectors.pkl", 'rb') as f:
                    self.content_vectors = pickle.load(f)
                    
        except Exception as e:
            logger.error(f"Erro ao carregar base de conhecimento: {e}")
    
    def _save_knowledge_base(self):
        """Salva base de conhecimento no armazenamento"""
        try:
            os.makedirs(self.storage_path, exist_ok=True)
            
            # Salva itens de conhecimento
            items_data = []
            for item in self.knowledge_items.values():
                item_dict = asdict(item)
                item_dict['category'] = item.category.value
                item_dict['created_at'] = item.created_at.isoformat()
                item_dict['updated_at'] = item.updated_at.isoformat()
                items_data.append(item_dict)
            
            with open(f"{self.storage_path}/knowledge_items.json", 'w', encoding='utf-8') as f:
                json.dump(items_data, f, ensure_ascii=False, indent=2)
            
            # Salva vectorizer
            if self.is_vectorizer_fitted:
                with open(f"{self.storage_path}/vectorizer.pkl", 'wb') as f:
                    pickle.dump(self.vectorizer, f)
            
            # Salva vetores
            if self.content_vectors is not None:
                with open(f"{self.storage_path}/content_vectors.pkl", 'wb') as f:
                    pickle.dump(self.content_vectors, f)
                    
        except Exception as e:
            logger.error(f"Erro ao salvar base de conhecimento: {e}")
    
    def _initialize_default_knowledge(self):
        """Inicializa conhecimento padrão se a base estiver vazia"""
        if len(self.knowledge_items) > 0:
            return
        
        default_items = [
            # Informações do produto
            KnowledgeItem(
                id="",
                category=KnowledgeCategory.PRODUCT_INFO,
                title="LinkMágico Chatbot - Visão Geral",
                content="""O LinkMágico Chatbot é uma solução de IA conversacional de nova geração que revoluciona o atendimento ao cliente e vendas online. 
                Diferente dos chatbots tradicionais, oferece conversas naturais, inteligência contextual e capacidade de extração universal de dados web. 
                Funciona 24/7, nunca trava, e é capaz de atender múltiplos clientes simultaneamente com respostas personalizadas e persuasivas.""",
                keywords=["linkmagico", "chatbot", "ia", "conversacional", "atendimento", "vendas", "24/7"],
                context_tags=["product_overview", "introduction", "capabilities"],
                priority=10,
                confidence_score=1.0,
                source="produto_oficial"
            ),
            
            # Técnicas de vendas
            KnowledgeItem(
                id="",
                category=KnowledgeCategory.SALES_TECHNIQUES,
                title="Técnica SPIN Selling",
                content="""SPIN Selling é uma metodologia poderosa baseada em 4 tipos de perguntas:
                - Situation (Situação): Entenda o contexto atual do cliente
                - Problem (Problema): Identifique dores e desafios
                - Implication (Implicação): Explore as consequências dos problemas
                - Need-payoff (Necessidade-benefício): Mostre o valor da solução
                Use esta sequência para guiar conversas de vendas de forma consultiva.""",
                keywords=["spin", "selling", "perguntas", "vendas", "consultiva", "metodologia"],
                context_tags=["sales_process", "questioning", "discovery"],
                priority=9,
                confidence_score=0.9,
                source="metodologia_vendas"
            ),
            
            # Tratamento de objeções
            KnowledgeItem(
                id="",
                category=KnowledgeCategory.OBJECTION_HANDLING,
                title="Objeção: 'É muito caro'",
                content="""Quando o cliente diz que é caro, responda:
                1. Reconheça: 'Entendo sua preocupação com o investimento'
                2. Reframe: 'Vamos pensar no custo de não resolver esse problema'
                3. Valor: 'Considerando os resultados que você vai obter...'
                4. ROI: 'Em quanto tempo você recuperaria esse investimento?'
                5. Alternativas: 'Temos opções que podem se adequar melhor ao seu orçamento'
                Sempre foque no valor, não no preço.""",
                keywords=["caro", "preço", "investimento", "orçamento", "custo", "valor"],
                context_tags=["price_objection", "value_selling", "roi"],
                priority=8,
                confidence_score=0.9,
                source="treinamento_vendas"
            ),
            
            # Casos de sucesso
            KnowledgeItem(
                id="",
                category=KnowledgeCategory.CUSTOMER_STORIES,
                title="Caso de Sucesso: E-commerce 300% de Conversão",
                content="""Uma loja online de eletrônicos implementou o LinkMágico e viu resultados impressionantes:
                - 300% de aumento na conversão de visitantes em leads
                - 85% de redução no tempo de resposta ao cliente
                - 40% de aumento nas vendas online em 60 dias
                - ROI de 450% no primeiro ano
                O segredo foi a personalização das conversas e o atendimento 24/7 que nunca deixa o cliente sem resposta.""",
                keywords=["caso", "sucesso", "ecommerce", "conversão", "resultados", "roi"],
                context_tags=["social_proof", "results", "ecommerce"],
                priority=9,
                confidence_score=0.8,
                source="case_study"
            ),
            
            # FAQs
            KnowledgeItem(
                id="",
                category=KnowledgeCategory.FAQS,
                title="FAQ: Como funciona a integração?",
                content="""A integração do LinkMágico é simples e rápida:
                1. Configuração inicial em 15 minutos
                2. Personalização da base de conhecimento
                3. Treinamento da IA com seus dados
                4. Testes e ajustes finais
                5. Go-live
                
                Oferecemos suporte completo durante todo o processo. A maioria dos clientes está operacional em menos de 24 horas.""",
                keywords=["integração", "implementação", "configuração", "setup", "instalação"],
                context_tags=["implementation", "technical", "process"],
                priority=7,
                confidence_score=0.9,
                source="documentacao_tecnica"
            ),
            
            # Benefícios
            KnowledgeItem(
                id="",
                category=KnowledgeCategory.BENEFITS,
                title="Benefício: Atendimento 24/7 Sem Limites",
                content="""Diferente de equipes humanas, o LinkMágico oferece:
                - Atendimento 24 horas por dia, 7 dias por semana
                - Capacidade ilimitada de atendimentos simultâneos
                - Consistência na qualidade das respostas
                - Redução de 90% nos custos operacionais
                - Escalabilidade instantânea para picos de demanda
                - Zero tempo de espera para o cliente
                
                Isso significa que você nunca perde uma venda por falta de atendimento.""",
                keywords=["24/7", "atendimento", "simultâneo", "escalabilidade", "custos", "disponibilidade"],
                context_tags=["availability", "scalability", "cost_reduction"],
                priority=8,
                confidence_score=1.0,
                source="especificacoes_produto"
            ),
            
            # Comparações
            KnowledgeItem(
                id="",
                category=KnowledgeCategory.COMPARISONS,
                title="LinkMágico vs Chatbots Tradicionais",
                content="""Diferenças fundamentais:
                
                Chatbots Tradicionais:
                - Respostas engessadas e limitadas
                - Travam com perguntas fora do script
                - Não aprendem nem se adaptam
                - Experiência frustrante para o usuário
                
                LinkMágico:
                - Conversas naturais e fluidas
                - Inteligência contextual avançada
                - Aprendizado contínuo
                - Experiência humanizada
                - Foco em conversão e vendas""",
                keywords=["comparação", "diferenças", "tradicional", "vantagens", "superior"],
                context_tags=["competitive_advantage", "differentiation"],
                priority=8,
                confidence_score=0.9,
                source="analise_competitiva"
            )
        ]
        
        for item in default_items:
            self.add_knowledge_item(item)
        
        logger.info(f"Inicializada base de conhecimento com {len(default_items)} itens padrão")
    
    def add_knowledge_item(self, item: KnowledgeItem) -> str:
        """Adiciona item à base de conhecimento"""
        if not item.id:
            item.id = item._generate_id()
        
        item.updated_at = datetime.now()
        self.knowledge_items[item.id] = item
        
        # Refit vectorizer se necessário
        self._update_vectors()
        self._save_knowledge_base()
        
        logger.info(f"Item de conhecimento adicionado: {item.title}")
        return item.id
    
    def update_knowledge_item(self, item_id: str, updates: Dict[str, Any]) -> bool:
        """Atualiza item existente"""
        if item_id not in self.knowledge_items:
            return False
        
        item = self.knowledge_items[item_id]
        for key, value in updates.items():
            if hasattr(item, key):
                setattr(item, key, value)
        
        item.updated_at = datetime.now()
        self._update_vectors()
        self._save_knowledge_base()
        
        logger.info(f"Item de conhecimento atualizado: {item_id}")
        return True
    
    def delete_knowledge_item(self, item_id: str) -> bool:
        """Remove item da base de conhecimento"""
        if item_id not in self.knowledge_items:
            return False
        
        del self.knowledge_items[item_id]
        self._update_vectors()
        self._save_knowledge_base()
        
        logger.info(f"Item de conhecimento removido: {item_id}")
        return True
    
    def search(self, query: str, category: Optional[KnowledgeCategory] = None, 
              context_tags: Optional[List[str]] = None, max_results: int = 5) -> List[SearchResult]:
        """Busca inteligente na base de conhecimento"""
        
        if not self.knowledge_items:
            return []
        
        # Filtra por categoria se especificada
        items_to_search = list(self.knowledge_items.values())
        if category:
            items_to_search = [item for item in items_to_search if item.category == category]
        
        # Filtra por context_tags se especificadas
        if context_tags:
            items_to_search = [
                item for item in items_to_search 
                if any(tag in item.context_tags for tag in context_tags)
            ]
        
        if not items_to_search:
            return []
        
        results = []
        
        # 1. Busca exata por palavras-chave
        exact_matches = self._search_exact_keywords(query, items_to_search)
        results.extend(exact_matches)
        
        # 2. Busca semântica usando TF-IDF
        if self.content_vectors is not None and self.is_vectorizer_fitted:
            semantic_matches = self._search_semantic(query, items_to_search)
            results.extend(semantic_matches)
        
        # 3. Busca por título e conteúdo
        text_matches = self._search_text_similarity(query, items_to_search)
        results.extend(text_matches)
        
        # Remove duplicatas e ordena por relevância
        unique_results = {}
        for result in results:
            if result.item.id not in unique_results or result.relevance_score > unique_results[result.item.id].relevance_score:
                unique_results[result.item.id] = result
        
        # Ordena por relevância e prioridade
        sorted_results = sorted(
            unique_results.values(),
            key=lambda x: (x.relevance_score * 0.7 + x.item.priority * 0.1 + x.item.effectiveness_score * 0.2),
            reverse=True
        )
        
        return sorted_results[:max_results]
    
    def _search_exact_keywords(self, query: str, items: List[KnowledgeItem]) -> List[SearchResult]:
        """Busca exata por palavras-chave"""
        results = []
        query_words = set(query.lower().split())
        
        for item in items:
            item_keywords = set([kw.lower() for kw in item.keywords])
            matched_keywords = query_words.intersection(item_keywords)
            
            if matched_keywords:
                relevance = len(matched_keywords) / len(query_words)
                results.append(SearchResult(
                    item=item,
                    relevance_score=relevance,
                    match_type='exact',
                    matched_keywords=list(matched_keywords)
                ))
        
        return results
    
    def _search_semantic(self, query: str, items: List[KnowledgeItem]) -> List[SearchResult]:
        """Busca semântica usando vetorização"""
        try:
            # Vetoriza a query
            query_vector = self.vectorizer.transform([query])
            
            # Calcula similaridade com todos os itens
            item_ids = [item.id for item in items]
            item_indices = [list(self.knowledge_items.keys()).index(item_id) for item_id in item_ids]
            
            if len(item_indices) == 0:
                return []
            
            relevant_vectors = self.content_vectors[item_indices]
            similarities = cosine_similarity(query_vector, relevant_vectors)[0]
            
            results = []
            for i, similarity in enumerate(similarities):
                if similarity > 0.1:  # Threshold mínimo
                    results.append(SearchResult(
                        item=items[i],
                        relevance_score=similarity,
                        match_type='semantic',
                        matched_keywords=[]
                    ))
            
            return results
            
        except Exception as e:
            logger.error(f"Erro na busca semântica: {e}")
            return []
    
    def _search_text_similarity(self, query: str, items: List[KnowledgeItem]) -> List[SearchResult]:
        """Busca por similaridade textual simples"""
        results = []
        query_lower = query.lower()
        
        for item in items:
            # Busca no título
            title_score = 0
            if query_lower in item.title.lower():
                title_score = 0.8
            
            # Busca no conteúdo
            content_score = 0
            if query_lower in item.content.lower():
                content_score = 0.5
            
            # Busca parcial por palavras
            query_words = query_lower.split()
            word_matches = 0
            total_text = f"{item.title} {item.content}".lower()
            
            for word in query_words:
                if word in total_text:
                    word_matches += 1
            
            word_score = word_matches / len(query_words) * 0.3
            
            total_score = title_score + content_score + word_score
            
            if total_score > 0.1:
                results.append(SearchResult(
                    item=item,
                    relevance_score=total_score,
                    match_type='text',
                    matched_keywords=[]
                ))
        
        return results
    
    def _update_vectors(self):
        """Atualiza vetores TF-IDF"""
        if not self.knowledge_items:
            return
        
        try:
            # Prepara textos para vetorização
            texts = []
            for item in self.knowledge_items.values():
                text = f"{item.title} {item.content} {' '.join(item.keywords)}"
                texts.append(text)
            
            # Fit e transform
            self.content_vectors = self.vectorizer.fit_transform(texts)
            self.is_vectorizer_fitted = True
            
            logger.info(f"Vetores atualizados para {len(texts)} itens")
            
        except Exception as e:
            logger.error(f"Erro ao atualizar vetores: {e}")
    
    def get_knowledge_by_category(self, category: KnowledgeCategory) -> List[KnowledgeItem]:
        """Retorna todos os itens de uma categoria"""
        return [item for item in self.knowledge_items.values() if item.category == category]
    
    def get_knowledge_by_tags(self, tags: List[str]) -> List[KnowledgeItem]:
        """Retorna itens que contêm qualquer uma das tags"""
        return [
            item for item in self.knowledge_items.values()
            if any(tag in item.context_tags for tag in tags)
        ]
    
    def update_usage_stats(self, item_id: str, was_helpful: bool = True):
        """Atualiza estatísticas de uso de um item"""
        if item_id not in self.knowledge_items:
            return
        
        item = self.knowledge_items[item_id]
        item.usage_count += 1
        
        # Atualiza effectiveness_score baseado no feedback
        if was_helpful:
            item.effectiveness_score = min(1.0, item.effectiveness_score + 0.1)
        else:
            item.effectiveness_score = max(0.0, item.effectiveness_score - 0.05)
        
        self._save_knowledge_base()
    
    def get_stats(self) -> Dict[str, Any]:
        """Retorna estatísticas da base de conhecimento"""
        if not self.knowledge_items:
            return {"total_items": 0}
        
        categories = {}
        total_usage = 0
        avg_effectiveness = 0
        
        for item in self.knowledge_items.values():
            cat = item.category.value
            categories[cat] = categories.get(cat, 0) + 1
            total_usage += item.usage_count
            avg_effectiveness += item.effectiveness_score
        
        avg_effectiveness /= len(self.knowledge_items)
        
        return {
            "total_items": len(self.knowledge_items),
            "categories": categories,
            "total_usage": total_usage,
            "average_effectiveness": avg_effectiveness,
            "vectorizer_fitted": self.is_vectorizer_fitted
        }
    
    def export_knowledge(self, file_path: str):
        """Exporta base de conhecimento para arquivo JSON"""
        try:
            items_data = []
            for item in self.knowledge_items.values():
                item_dict = asdict(item)
                item_dict['category'] = item.category.value
                item_dict['created_at'] = item.created_at.isoformat()
                item_dict['updated_at'] = item.updated_at.isoformat()
                items_data.append(item_dict)
            
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(items_data, f, ensure_ascii=False, indent=2)
            
            logger.info(f"Base de conhecimento exportada para {file_path}")
            
        except Exception as e:
            logger.error(f"Erro ao exportar base de conhecimento: {e}")
    
    def import_knowledge(self, file_path: str):
        """Importa base de conhecimento de arquivo JSON"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                items_data = json.load(f)
            
            imported_count = 0
            for item_data in items_data:
                try:
                    item = KnowledgeItem(**item_data)
                    item.category = KnowledgeCategory(item.category)
                    item.created_at = datetime.fromisoformat(item.created_at)
                    item.updated_at = datetime.fromisoformat(item.updated_at)
                    
                    self.knowledge_items[item.id] = item
                    imported_count += 1
                    
                except Exception as e:
                    logger.warning(f"Erro ao importar item: {e}")
                    continue
            
            self._update_vectors()
            self._save_knowledge_base()
            
            logger.info(f"Importados {imported_count} itens de conhecimento")
            
        except Exception as e:
            logger.error(f"Erro ao importar base de conhecimento: {e}")

