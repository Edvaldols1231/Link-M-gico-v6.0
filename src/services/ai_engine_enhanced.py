import os
import json
import openai
from typing import Dict, List, Optional, Tuple, Any
import re
from datetime import datetime
import logging
import asyncio
import hashlib
from dataclasses import dataclass
from enum import Enum
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ConversationStage(Enum):
    """Estágios da conversa de vendas"""
    AWARENESS = "awareness"
    INTEREST = "interest"
    CONSIDERATION = "consideration"
    INTENT = "intent"
    EVALUATION = "evaluation"
    PURCHASE = "purchase"
    RETENTION = "retention"

class EmotionalState(Enum):
    """Estados emocionais do cliente"""
    EXCITED = "excited"
    CURIOUS = "curious"
    SKEPTICAL = "skeptical"
    CONFUSED = "confused"
    FRUSTRATED = "frustrated"
    CONFIDENT = "confident"
    HESITANT = "hesitant"
    URGENT = "urgent"

@dataclass
class UserProfile:
    """Perfil detalhado do usuário"""
    session_id: str
    name: Optional[str] = None
    interests: List[str] = None
    pain_points: List[str] = None
    budget_range: Optional[str] = None
    decision_timeline: Optional[str] = None
    communication_style: Optional[str] = None
    previous_objections: List[str] = None
    engagement_level: float = 0.5
    trust_level: float = 0.5
    purchase_readiness: float = 0.0
    
    def __post_init__(self):
        if self.interests is None:
            self.interests = []
        if self.pain_points is None:
            self.pain_points = []
        if self.previous_objections is None:
            self.previous_objections = []

@dataclass
class ConversationContext:
    """Contexto completo da conversa"""
    session_id: str
    current_stage: ConversationStage
    emotional_state: EmotionalState
    user_profile: UserProfile
    conversation_history: List[Dict]
    web_data: Optional[Dict] = None
    current_intent: Optional[str] = None
    confidence_score: float = 0.0
    last_interaction: Optional[datetime] = None

class EnhancedAIConversationEngine:
    """Motor de IA conversacional avançado com inteligência adaptativa"""
    
    def __init__(self):
        self.client = openai.OpenAI(
            api_key=os.getenv('OPENAI_API_KEY'),
            base_url=os.getenv('OPENAI_API_BASE')
        )
        
        # Configurações do modelo
        self.primary_model = os.getenv('PRIMARY_LLM_MODEL', 'gpt-4.1-mini')
        self.analysis_model = os.getenv('ANALYSIS_LLM_MODEL', 'gpt-4.1-nano')
        
        # Contextos de conversa em memória (será migrado para DB)
        self.conversation_contexts: Dict[str, ConversationContext] = {}
        self.user_profiles: Dict[str, UserProfile] = {}
        
        # Sistema de prompts dinâmicos
        self.prompt_templates = self._load_dynamic_prompts()
        self.persuasion_techniques = self._load_persuasion_techniques()
        
        # Vectorizer para análise semântica
        self.vectorizer = TfidfVectorizer(max_features=1000, stop_words='english')
        self.knowledge_embeddings = {}
        
        logger.info("Enhanced AI Conversation Engine inicializado")
    
    def _load_dynamic_prompts(self) -> Dict[str, Dict]:
        """Carrega templates de prompts dinâmicos organizados por estágio e contexto"""
        return {
            "system_personas": {
                "consultative_seller": """Você é um consultor de vendas altamente experiente e empático. 
                Sua abordagem é consultiva, focando primeiro em entender profundamente as necessidades 
                do cliente antes de apresentar soluções. Você nunca pressiona, mas guia naturalmente 
                o cliente através de um processo de descoberta que os leva a perceber o valor da solução.""",
                
                "solution_expert": """Você é um especialista técnico em soluções que também possui 
                habilidades excepcionais de comunicação. Você consegue explicar conceitos complexos 
                de forma simples e sempre conecta características técnicas aos benefícios práticos 
                que o cliente experimentará.""",
                
                "trusted_advisor": """Você é um conselheiro de confiança que coloca os interesses 
                do cliente em primeiro lugar. Sua credibilidade vem da honestidade, transparência 
                e do histórico de ajudar clientes a tomar as melhores decisões para suas situações específicas."""
            },
            
            "stage_prompts": {
                ConversationStage.AWARENESS: {
                    "primary": """O cliente está na fase de conscientização. Foque em:
                    1. Identificar e validar problemas/necessidades
                    2. Educar sobre possibilidades e oportunidades
                    3. Construir rapport e confiança
                    4. Fazer perguntas abertas para entender o contexto
                    5. Evitar falar sobre produtos/soluções específicas ainda""",
                    
                    "questions": [
                        "Que desafios você tem enfrentado em [área relevante]?",
                        "Como isso tem impactado seus resultados/objetivos?",
                        "O que você já tentou para resolver essa situação?",
                        "Se pudesse resolver isso, que diferença faria para você?"
                    ]
                },
                
                ConversationStage.INTEREST: {
                    "primary": """O cliente demonstrou interesse. Agora foque em:
                    1. Aprofundar o entendimento das necessidades específicas
                    2. Apresentar possibilidades de solução de forma conceitual
                    3. Usar storytelling com casos similares
                    4. Criar visão do estado futuro desejado
                    5. Qualificar orçamento e timeline de forma sutil""",
                    
                    "questions": [
                        "Conte-me mais sobre como isso funcionaria no seu contexto específico",
                        "Que resultados você gostaria de ver em [timeframe]?",
                        "Quem mais seria impactado por essa mudança?",
                        "Que investimento faria sentido para alcançar esses resultados?"
                    ]
                },
                
                ConversationStage.CONSIDERATION: {
                    "primary": """O cliente está avaliando opções. Foque em:
                    1. Diferenciar sua solução de forma clara
                    2. Abordar objeções antes que sejam verbalizadas
                    3. Fornecer prova social relevante
                    4. Criar senso de urgência apropriado
                    5. Facilitar o processo de tomada de decisão""",
                    
                    "questions": [
                        "Que critérios são mais importantes na sua decisão?",
                        "Que preocupações você tem sobre implementar uma solução?",
                        "Como você costuma avaliar esse tipo de investimento?",
                        "Que timeline você tem em mente para tomar essa decisão?"
                    ]
                },
                
                ConversationStage.INTENT: {
                    "primary": """O cliente demonstrou intenção de compra. Foque em:
                    1. Confirmar fit e expectativas
                    2. Abordar últimas objeções
                    3. Simplificar o processo de compra
                    4. Criar urgência genuína
                    5. Facilitar a decisão final""",
                    
                    "questions": [
                        "O que você precisa para se sentir 100% confiante nessa decisão?",
                        "Que informações adicionais posso fornecer?",
                        "Como podemos tornar a implementação mais fácil para você?",
                        "Quando você gostaria de começar a ver resultados?"
                    ]
                }
            },
            
            "emotional_responses": {
                EmotionalState.SKEPTICAL: """O cliente está cético. Responda com:
                - Validação das preocupações
                - Transparência total
                - Prova social específica e verificável
                - Ofertas de teste ou garantias
                - Foco em redução de risco""",
                
                EmotionalState.EXCITED: """O cliente está animado. Mantenha o momentum:
                - Compartilhe o entusiasmo de forma profissional
                - Canalize a energia para ação
                - Forneça próximos passos claros
                - Evite overselling
                - Mantenha expectativas realistas""",
                
                EmotionalState.CONFUSED: """O cliente está confuso. Simplifique:
                - Use linguagem mais simples
                - Quebre informações em partes menores
                - Use analogias e exemplos
                - Confirme entendimento frequentemente
                - Ofereça recursos adicionais""",
                
                EmotionalState.FRUSTRATED: """O cliente está frustrado. Acalme:
                - Reconheça a frustração
                - Assuma responsabilidade se apropriado
                - Foque em soluções, não problemas
                - Ofereça suporte adicional
                - Demonstre empatia genuína"""
            }
        }
    
    def _load_persuasion_techniques(self) -> Dict[str, Dict]:
        """Carrega técnicas de persuasão baseadas em psicologia"""
        return {
            "reciprocity": {
                "description": "Oferecer valor antes de pedir algo em troca",
                "triggers": ["dar informação valiosa", "oferecer recurso gratuito", "compartilhar insight"],
                "implementation": "Forneça insights valiosos ou recursos úteis antes de fazer qualquer pedido"
            },
            
            "social_proof": {
                "description": "Mostrar que outros fizeram a mesma escolha",
                "triggers": ["mencionar outros clientes", "estatísticas de uso", "depoimentos"],
                "implementation": "Use casos de clientes similares, estatísticas de sucesso e depoimentos relevantes"
            },
            
            "authority": {
                "description": "Demonstrar expertise e credibilidade",
                "triggers": ["compartilhar experiência", "mencionar credenciais", "citar pesquisas"],
                "implementation": "Demonstre conhecimento profundo e cite fontes confiáveis"
            },
            
            "scarcity": {
                "description": "Criar senso de urgência ou exclusividade",
                "triggers": ["oferta limitada", "deadline", "disponibilidade restrita"],
                "implementation": "Use apenas quando genuíno - prazos reais, vagas limitadas, etc."
            },
            
            "commitment": {
                "description": "Fazer o cliente se comprometer com pequenos passos",
                "triggers": ["pequenos acordos", "confirmações", "próximos passos"],
                "implementation": "Obtenha pequenos 'sins' que levam ao compromisso maior"
            },
            
            "liking": {
                "description": "Construir rapport e conexão pessoal",
                "triggers": ["pontos em comum", "elogios genuínos", "similaridades"],
                "implementation": "Encontre pontos de conexão genuínos e demonstre interesse real na pessoa"
            }
        }
    
    async def analyze_user_intent_enhanced(self, message: str, context: ConversationContext) -> Dict[str, Any]:
        """Análise aprofundada de intenção com múltiplas dimensões"""
        try:
            # Prompt para análise detalhada
            analysis_prompt = f"""
            Analise esta mensagem do cliente considerando o contexto da conversa.
            
            Mensagem atual: "{message}"
            
            Contexto da conversa:
            - Estágio atual: {context.current_stage.value}
            - Estado emocional anterior: {context.emotional_state.value}
            - Histórico recente: {json.dumps(context.conversation_history[-3:], ensure_ascii=False)}
            - Perfil do usuário: {json.dumps(context.user_profile.__dict__, ensure_ascii=False)}
            
            Retorne um JSON com:
            {{
                "primary_intent": "greeting|question|objection|interest|ready_to_buy|price_inquiry|comparison|clarification|complaint|other",
                "secondary_intents": ["lista de intenções secundárias"],
                "emotional_state": "excited|curious|skeptical|confused|frustrated|confident|hesitant|urgent",
                "conversation_stage": "awareness|interest|consideration|intent|evaluation|purchase|retention",
                "urgency_level": 1-10,
                "engagement_level": 1-10,
                "trust_indicators": ["lista de indicadores de confiança"],
                "objection_signals": ["lista de sinais de objeção"],
                "buying_signals": ["lista de sinais de compra"],
                "pain_points_mentioned": ["lista de dores mencionadas"],
                "value_drivers": ["lista de valores importantes para o cliente"],
                "next_best_action": "ask_question|provide_info|address_objection|present_solution|close|nurture",
                "confidence_score": 0.0-1.0,
                "recommended_persuasion_techniques": ["lista de técnicas recomendadas"],
                "personality_indicators": {{
                    "communication_style": "direct|analytical|expressive|amiable",
                    "decision_making": "quick|deliberate|collaborative|research_heavy",
                    "risk_tolerance": "high|medium|low"
                }}
            }}
            """
            
            response = await self._call_llm_async(
                model=self.analysis_model,
                messages=[
                    {"role": "system", "content": "Você é um especialista em análise de comportamento de clientes e psicologia de vendas. Retorne apenas JSON válido."},
                    {"role": "user", "content": analysis_prompt}
                ],
                temperature=0.2,
                max_tokens=800
            )
            
            analysis = json.loads(response.choices[0].message.content)
            
            # Atualiza o perfil do usuário com insights descobertos
            self._update_user_profile(context.user_profile, analysis)
            
            return analysis
            
        except Exception as e:
            logger.error(f"Erro na análise de intenção aprimorada: {e}")
            return self._get_fallback_analysis()
    
    async def generate_adaptive_response(self, message: str, context: ConversationContext, web_data: Optional[Dict] = None) -> str:
        """Gera resposta adaptativa usando múltiplas estratégias"""
        try:
            # Análise detalhada da mensagem
            intent_analysis = await self.analyze_user_intent_enhanced(message, context)
            
            # Atualiza contexto com nova análise
            context.current_intent = intent_analysis.get("primary_intent")
            context.confidence_score = intent_analysis.get("confidence_score", 0.5)
            context.emotional_state = EmotionalState(intent_analysis.get("emotional_state", "curious"))
            context.current_stage = ConversationStage(intent_analysis.get("conversation_stage", "consideration"))
            
            # Seleciona persona e estratégia
            persona = self._select_optimal_persona(context, intent_analysis)
            strategy = self._select_response_strategy(context, intent_analysis)
            
            # Constrói prompt dinâmico
            dynamic_prompt = self._build_dynamic_prompt(
                persona=persona,
                strategy=strategy,
                context=context,
                intent_analysis=intent_analysis,
                web_data=web_data
            )
            
            # Gera resposta principal
            main_response = await self._generate_main_response(
                prompt=dynamic_prompt,
                message=message,
                context=context
            )
            
            # Aplica técnicas de persuasão
            enhanced_response = self._apply_persuasion_techniques(
                response=main_response,
                techniques=intent_analysis.get("recommended_persuasion_techniques", []),
                context=context
            )
            
            # Adiciona elementos contextuais
            final_response = self._add_contextual_elements(
                response=enhanced_response,
                context=context,
                intent_analysis=intent_analysis
            )
            
            # Atualiza histórico
            self._update_conversation_history(context, message, final_response, intent_analysis)
            
            return final_response
            
        except Exception as e:
            logger.error(f"Erro na geração de resposta adaptativa: {e}")
            return self._get_intelligent_fallback(context, message)
    
    def _select_optimal_persona(self, context: ConversationContext, analysis: Dict) -> str:
        """Seleciona a persona mais adequada baseada no contexto e análise"""
        personality = analysis.get("personality_indicators", {})
        communication_style = personality.get("communication_style", "expressive")
        stage = context.current_stage
        trust_level = context.user_profile.trust_level
        
        # Lógica de seleção de persona
        if trust_level < 0.4:
            return "trusted_advisor"
        elif stage in [ConversationStage.AWARENESS, ConversationStage.INTEREST]:
            return "consultative_seller"
        elif communication_style == "analytical" or stage == ConversationStage.EVALUATION:
            return "solution_expert"
        else:
            return "consultative_seller"
    
    def _select_response_strategy(self, context: ConversationContext, analysis: Dict) -> Dict:
        """Seleciona estratégia de resposta baseada no contexto"""
        stage = context.current_stage
        emotional_state = context.emotional_state
        next_action = analysis.get("next_best_action", "provide_info")
        
        strategy = {
            "primary_objective": next_action,
            "tone": self._determine_tone(emotional_state, analysis),
            "structure": self._determine_structure(stage, analysis),
            "persuasion_focus": self._determine_persuasion_focus(stage, analysis)
        }
        
        return strategy
    
    def _build_dynamic_prompt(self, persona: str, strategy: Dict, context: ConversationContext, 
                            intent_analysis: Dict, web_data: Optional[Dict]) -> str:
        """Constrói prompt dinâmico baseado em todos os fatores contextuais"""
        
        # Persona base
        persona_prompt = self.prompt_templates["system_personas"][persona]
        
        # Prompt específico do estágio
        stage_prompt = self.prompt_templates["stage_prompts"][context.current_stage]["primary"]
        
        # Prompt emocional
        emotional_prompt = self.prompt_templates["emotional_responses"].get(
            context.emotional_state, 
            "Mantenha um tom profissional e empático."
        )
        
        # Contexto do usuário
        user_context = f"""
        Perfil do Cliente:
        - Interesses: {', '.join(context.user_profile.interests)}
        - Pontos de dor: {', '.join(context.user_profile.pain_points)}
        - Nível de engajamento: {context.user_profile.engagement_level:.1f}/1.0
        - Nível de confiança: {context.user_profile.trust_level:.1f}/1.0
        - Prontidão para compra: {context.user_profile.purchase_readiness:.1f}/1.0
        - Estilo de comunicação: {intent_analysis.get('personality_indicators', {}).get('communication_style', 'não identificado')}
        """
        
        # Dados web se disponíveis
        web_context = ""
        if web_data:
            web_context = f"""
            Informações do Produto/Serviço:
            - Título: {web_data.get('title', 'N/A')}
            - Descrição: {web_data.get('description', 'N/A')}
            - Características principais: {web_data.get('main_features', 'N/A')}
            """
        
        # Histórico recente
        history_context = ""
        if context.conversation_history:
            recent_history = context.conversation_history[-3:]
            history_context = f"Histórico recente: {json.dumps(recent_history, ensure_ascii=False)}"
        
        # Prompt final
        dynamic_prompt = f"""
        {persona_prompt}
        
        CONTEXTO DA CONVERSA:
        {stage_prompt}
        
        ESTADO EMOCIONAL:
        {emotional_prompt}
        
        {user_context}
        
        {web_context}
        
        {history_context}
        
        ESTRATÉGIA DE RESPOSTA:
        - Objetivo principal: {strategy['primary_objective']}
        - Tom: {strategy['tone']}
        - Estrutura: {strategy['structure']}
        - Foco de persuasão: {strategy['persuasion_focus']}
        
        INSTRUÇÕES ESPECÍFICAS:
        1. Seja genuíno e autêntico, nunca robótico
        2. Adapte sua linguagem ao estilo de comunicação do cliente
        3. Use as informações do contexto para personalizar sua resposta
        4. Mantenha o foco no valor para o cliente
        5. Faça perguntas estratégicas quando apropriado
        6. Use storytelling quando relevante
        7. Seja específico e evite generalidades
        """
        
        return dynamic_prompt
    
    async def _generate_main_response(self, prompt: str, message: str, context: ConversationContext) -> str:
        """Gera a resposta principal usando o prompt dinâmico"""
        try:
            response = await self._call_llm_async(
                model=self.primary_model,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": f"Cliente disse: {message}"}
                ],
                temperature=0.7,
                max_tokens=1000,
                presence_penalty=0.6,
                frequency_penalty=0.4
            )
            
            return response.choices[0].message.content
            
        except Exception as e:
            logger.error(f"Erro na geração da resposta principal: {e}")
            raise
    
    def _apply_persuasion_techniques(self, response: str, techniques: List[str], context: ConversationContext) -> str:
        """Aplica técnicas de persuasão à resposta"""
        enhanced_response = response
        
        for technique in techniques:
            if technique in self.persuasion_techniques:
                technique_data = self.persuasion_techniques[technique]
                enhanced_response = self._apply_specific_technique(
                    enhanced_response, technique, technique_data, context
                )
        
        return enhanced_response
    
    def _apply_specific_technique(self, response: str, technique: str, technique_data: Dict, context: ConversationContext) -> str:
        """Aplica uma técnica específica de persuasão"""
        
        if technique == "social_proof" and context.user_profile.trust_level < 0.6:
            if not self._has_social_proof(response):
                social_proof = self._generate_relevant_social_proof(context)
                response += f"\n\n{social_proof}"
        
        elif technique == "scarcity" and context.current_stage in [ConversationStage.INTENT, ConversationStage.EVALUATION]:
            if not self._has_urgency(response):
                urgency = self._generate_appropriate_urgency(context)
                response += f"\n\n{urgency}"
        
        elif technique == "reciprocity" and context.current_stage == ConversationStage.AWARENESS:
            if not self._has_value_offer(response):
                value_offer = self._generate_value_offer(context)
                response += f"\n\n{value_offer}"
        
        return response
    
    def _add_contextual_elements(self, response: str, context: ConversationContext, analysis: Dict) -> str:
        """Adiciona elementos contextuais finais à resposta"""
        
        # Adiciona CTA apropriado se necessário
        if not self._has_call_to_action(response) and context.current_stage in [ConversationStage.INTENT, ConversationStage.EVALUATION]:
            cta = self._generate_contextual_cta(context, analysis)
            response += f"\n\n{cta}"
        
        # Adiciona pergunta estratégica se apropriado
        if analysis.get("next_best_action") == "ask_question":
            strategic_question = self._generate_strategic_question(context, analysis)
            response += f"\n\n{strategic_question}"
        
        return response
    
    def _update_user_profile(self, profile: UserProfile, analysis: Dict):
        """Atualiza o perfil do usuário com insights da análise"""
        
        # Atualiza pontos de dor
        new_pain_points = analysis.get("pain_points_mentioned", [])
        for pain_point in new_pain_points:
            if pain_point not in profile.pain_points:
                profile.pain_points.append(pain_point)
        
        # Atualiza drivers de valor
        value_drivers = analysis.get("value_drivers", [])
        for driver in value_drivers:
            if driver not in profile.interests:
                profile.interests.append(driver)
        
        # Atualiza níveis baseado em sinais
        engagement_signals = len(analysis.get("buying_signals", []))
        trust_signals = len(analysis.get("trust_indicators", []))
        objection_signals = len(analysis.get("objection_signals", []))
        
        # Ajusta engagement level
        if engagement_signals > 0:
            profile.engagement_level = min(1.0, profile.engagement_level + 0.1 * engagement_signals)
        
        # Ajusta trust level
        if trust_signals > objection_signals:
            profile.trust_level = min(1.0, profile.trust_level + 0.05 * (trust_signals - objection_signals))
        elif objection_signals > trust_signals:
            profile.trust_level = max(0.0, profile.trust_level - 0.05 * (objection_signals - trust_signals))
        
        # Atualiza purchase readiness
        buying_signals = analysis.get("buying_signals", [])
        if buying_signals:
            profile.purchase_readiness = min(1.0, profile.purchase_readiness + 0.1 * len(buying_signals))
    
    def _update_conversation_history(self, context: ConversationContext, user_message: str, bot_response: str, analysis: Dict):
        """Atualiza o histórico da conversa"""
        interaction = {
            "timestamp": datetime.now().isoformat(),
            "user_message": user_message,
            "bot_response": bot_response,
            "analysis": analysis,
            "stage": context.current_stage.value,
            "emotional_state": context.emotional_state.value
        }
        
        context.conversation_history.append(interaction)
        
        # Mantém apenas as últimas 50 interações
        if len(context.conversation_history) > 50:
            context.conversation_history = context.conversation_history[-50:]
        
        context.last_interaction = datetime.now()
    
    async def _call_llm_async(self, model: str, messages: List[Dict], **kwargs) -> Any:
        """Chama o LLM de forma assíncrona"""
        # Por enquanto, implementação síncrona
        # TODO: Implementar chamadas assíncronas reais
        return self.client.chat.completions.create(
            model=model,
            messages=messages,
            **kwargs
        )
    
    def get_or_create_context(self, session_id: str) -> ConversationContext:
        """Obtém ou cria contexto de conversa"""
        if session_id not in self.conversation_contexts:
            user_profile = self.user_profiles.get(session_id, UserProfile(session_id=session_id))
            self.user_profiles[session_id] = user_profile
            
            self.conversation_contexts[session_id] = ConversationContext(
                session_id=session_id,
                current_stage=ConversationStage.AWARENESS,
                emotional_state=EmotionalState.CURIOUS,
                user_profile=user_profile,
                conversation_history=[]
            )
        
        return self.conversation_contexts[session_id]
    
    # Métodos auxiliares para determinação de estratégias
    def _determine_tone(self, emotional_state: EmotionalState, analysis: Dict) -> str:
        tone_map = {
            EmotionalState.EXCITED: "entusiasmado mas profissional",
            EmotionalState.SKEPTICAL: "confiante e transparente",
            EmotionalState.CONFUSED: "paciente e didático",
            EmotionalState.FRUSTRATED: "empático e solucionador",
            EmotionalState.URGENT: "responsivo e eficiente"
        }
        return tone_map.get(emotional_state, "profissional e amigável")
    
    def _determine_structure(self, stage: ConversationStage, analysis: Dict) -> str:
        if stage == ConversationStage.AWARENESS:
            return "pergunta-descoberta-educação"
        elif stage == ConversationStage.INTEREST:
            return "validação-conceito-benefício"
        elif stage == ConversationStage.CONSIDERATION:
            return "diferenciação-prova-urgência"
        else:
            return "confirmação-simplificação-ação"
    
    def _determine_persuasion_focus(self, stage: ConversationStage, analysis: Dict) -> str:
        focus_map = {
            ConversationStage.AWARENESS: "construção de rapport e identificação de necessidades",
            ConversationStage.INTEREST: "demonstração de valor e criação de visão",
            ConversationStage.CONSIDERATION: "diferenciação e redução de risco",
            ConversationStage.INTENT: "simplificação e facilitação da decisão"
        }
        return focus_map.get(stage, "construção de valor")
    
    # Métodos auxiliares para verificação de elementos na resposta
    def _has_social_proof(self, response: str) -> bool:
        indicators = ["clientes", "empresas", "resultados", "casos", "sucesso", "%", "milhares"]
        return any(indicator in response.lower() for indicator in indicators)
    
    def _has_urgency(self, response: str) -> bool:
        indicators = ["agora", "hoje", "limitado", "prazo", "oportunidade", "momento"]
        return any(indicator in response.lower() for indicator in indicators)
    
    def _has_value_offer(self, response: str) -> bool:
        indicators = ["gratuito", "ofereço", "vou te dar", "recurso", "material", "guia"]
        return any(indicator in response.lower() for indicator in indicators)
    
    def _has_call_to_action(self, response: str) -> bool:
        indicators = ["clique", "acesse", "vamos", "próximo passo", "agende", "entre em contato"]
        return any(indicator in response.lower() for indicator in indicators)
    
    # Métodos de geração de elementos específicos
    def _generate_relevant_social_proof(self, context: ConversationContext) -> str:
        proofs = [
            "Mais de 95% dos nossos clientes relatam resultados positivos nos primeiros 30 dias.",
            "Já ajudamos mais de 10.000 empresas como a sua a alcançar seus objetivos.",
            "Nossos clientes veem em média 40% de melhoria nos resultados após a implementação."
        ]
        return proofs[hash(context.session_id) % len(proofs)]
    
    def _generate_appropriate_urgency(self, context: ConversationContext) -> str:
        urgencies = [
            "⏰ Estou disponível agora para te ajudar com todos os detalhes!",
            "🎯 Este é o momento ideal para dar esse passo importante.",
            "💡 Que tal aproveitarmos esse momentum para avançar?"
        ]
        return urgencies[hash(context.session_id) % len(urgencies)]
    
    def _generate_value_offer(self, context: ConversationContext) -> str:
        offers = [
            "Posso te enviar um guia completo sobre isso, sem compromisso.",
            "Tenho um material exclusivo que pode te ajudar - quer que eu compartilhe?",
            "Vou te dar acesso a uma ferramenta que pode esclarecer isso melhor."
        ]
        return offers[hash(context.session_id) % len(offers)]
    
    def _generate_contextual_cta(self, context: ConversationContext, analysis: Dict) -> str:
        if context.user_profile.purchase_readiness > 0.7:
            return "🚀 Que tal darmos o próximo passo? Posso te mostrar exatamente como começar!"
        elif context.user_profile.trust_level > 0.6:
            return "💬 Quer conversar mais sobre como isso funcionaria no seu caso específico?"
        else:
            return "📋 Posso te enviar mais informações para você avaliar com calma?"
    
    def _generate_strategic_question(self, context: ConversationContext, analysis: Dict) -> str:
        stage_questions = self.prompt_templates["stage_prompts"][context.current_stage].get("questions", [])
        if stage_questions:
            return stage_questions[hash(context.session_id) % len(stage_questions)]
        return "Como posso te ajudar melhor com isso?"
    
    def _get_fallback_analysis(self) -> Dict[str, Any]:
        """Retorna análise de fallback em caso de erro"""
        return {
            "primary_intent": "other",
            "emotional_state": "curious",
            "conversation_stage": "consideration",
            "urgency_level": 5,
            "engagement_level": 5,
            "confidence_score": 0.3,
            "next_best_action": "provide_info",
            "recommended_persuasion_techniques": ["liking"],
            "personality_indicators": {
                "communication_style": "expressive",
                "decision_making": "deliberate",
                "risk_tolerance": "medium"
            }
        }
    
    def _get_intelligent_fallback(self, context: ConversationContext, message: str) -> str:
        """Retorna resposta inteligente de fallback"""
        fallbacks = {
            "greeting": "Olá! É um prazer falar com você! Como posso te ajudar hoje? 😊",
            "question": "Excelente pergunta! Deixe-me te dar uma resposta completa e útil...",
            "objection": "Entendo sua preocupação, e é completamente normal ter essas dúvidas. Vou esclarecer isso para você...",
            "other": "Que interessante! Conte-me mais sobre isso para que eu possa te ajudar da melhor forma possível!"
        }
        
        # Tenta detectar tipo básico da mensagem
        if any(greeting in message.lower() for greeting in ["olá", "oi", "bom dia", "boa tarde", "boa noite"]):
            return fallbacks["greeting"]
        elif "?" in message:
            return fallbacks["question"]
        elif any(objection in message.lower() for objection in ["mas", "porém", "não sei", "dúvida", "preocupação"]):
            return fallbacks["objection"]
        else:
            return fallbacks["other"]

