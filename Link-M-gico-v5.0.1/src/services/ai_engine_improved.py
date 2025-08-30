import os
import json
import openai
from typing import Dict, List, Optional, Tuple
import re
from datetime import datetime
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AIConversationEngine:
    """Motor de IA conversacional avançado para vendas"""
    
    def __init__(self):
        groq_api_key = os.getenv("GROQ_API_KEY")
        openai_api_key = os.getenv("OPENAI_API_KEY")

        if groq_api_key:
            self.client = openai.OpenAI(
                api_key=groq_api_key,
                base_url="https://api.groq.com/openai/v1"
            )
            logger.info("Usando GROQ_API_KEY para o cliente OpenAI.")
        elif openai_api_key:
            self.client = openai.OpenAI(
                api_key=openai_api_key,
                base_url=os.getenv("OPENAI_API_BASE")
            )
            logger.info("Usando OPENAI_API_KEY para o cliente OpenAI.")
        else:
            raise ValueError("Nenhuma chave de API (GROQ_API_KEY ou OPENAI_API_KEY) encontrada.")        self.conversation_history = {}
        self.sales_prompts = self._load_sales_prompts()
        
    def _load_sales_prompts(self) -> Dict[str, str]:
        """Carrega prompts especializados para vendas"""
        return {
            "system_base": """Você é um assistente conversacional amigável e objetivo. Suas respostas devem ser curtas (no máximo 2 frases) e sempre terminar com uma pergunta para guiar a conversa. Mantenha um tom humano e amigável, evitando jargões de vendas excessivos. O objetivo é construir a conversa em etapas, fornecendo apenas a informação necessária para a pergunta feita, e só avançar no assunto se o usuário demonstrar interesse. Use emojis de forma sutil e natural.""",
            "greeting": """O usuário iniciou a conversa. Responda de forma amigável, curta e com uma pergunta para engajar. Não tente vender nada ainda.""",
            "objection_handling": """O usuário apresentou uma objeção ou dúvida. Responda de forma empática, curta e objetiva, esclarecendo a questão e devolvendo uma pergunta para continuar a conversa.""",
            "closing": """O usuário demonstrou interesse em avançar ou saber sobre valores. Responda de forma direta, oferecendo as opções e sempre com uma pergunta para guiar o próximo passo.""",
            "follow_up": """Continue a conversa de forma natural, respondendo à última pergunta do usuário de forma curta e objetiva, e sempre devolvendo uma nova pergunta para manter o fluxo conversacional."""
        }

    def generate_persuasive_response(self, message: str, context: Dict, web_data: Optional[Dict] = None, custom_instructions: str = "") -> str:
        """Gera resposta persuasiva baseada no contexto e dados da web"""
        try:
            intent_analysis = {
                "intent": "other",
                "sentiment": "neutral",
                "urgency_level": "medium",
                "buying_stage": "consideration",
                "emotional_state": "curious",
                "key_concerns": []
            }
            
            prompt_key = self._select_prompt_strategy(intent_analysis)
            base_prompt = self.sales_prompts.get(prompt_key, self.sales_prompts["follow_up"])
            
            full_context = self._build_conversation_context(context, web_data, intent_analysis)
            
            system_message = f"{self.sales_prompts['system_base']}\n\n{base_prompt}\n\nContexto adicional: {full_context}"
            
            if custom_instructions and custom_instructions.strip():
                system_message += f"\n\nInstruções personalizadas importantes: {custom_instructions.strip()}"
                system_message += "\nSiga essas instruções personalizadas mantendo sempre o foco em vendas e conversão."
            
            response = self.client.chat.completions.create(
                model="gpt-4.1-mini",
                messages=[
                    {"role": "system", "content": system_message},
                    {"role": "user", "content": f"Mensagem do cliente: {message}"}
                ],
                temperature=0.3,
                max_tokens=150,
                presence_penalty=0.6,
                frequency_penalty=0.4
            )
            
            generated_response = response.choices[0].message.content
            
            final_response = self._enhance_response_with_persuasion(generated_response, intent_analysis, web_data)
            final_response = self._post_process_response(final_response)
            return final_response
        except Exception as e:
            logger.error(f"Erro na geração de resposta: {e}")
            return self._get_fallback_response("other")
    
    def _select_prompt_strategy(self, intent_analysis: Dict) -> str:
        """Seleciona estratégia de prompt baseada na análise de intenção"""
        intent = intent_analysis.get("intent", "other")
        buying_stage = intent_analysis.get("buying_stage", "consideration")
        
        if intent == "greeting":
            return "greeting"
        elif intent == "objection":
            return "objection_handling"
        elif intent == "ready_to_buy" or buying_stage == "decision":
            return "closing"
        else:
            return "follow_up"
    
    def _build_conversation_context(self, context: Dict, web_data: Optional[Dict], intent_analysis: Dict) -> str:
        """Constrói contexto completo da conversa"""
        context_parts = []
        
        if context.get("previous_messages"):
            recent_messages = context["previous_messages"][-5:]
            context_parts.append(f'Histórico recente: {json.dumps(recent_messages, ensure_ascii=False)}')
        
        if web_data:
            context_parts.append(f'Informações do produto/serviço: {json.dumps(web_data, ensure_ascii=False)}')
        
        context_parts.append(f'Análise do cliente: {json.dumps(intent_analysis, ensure_ascii=False)}')
        
        if context.get("user_profile"):
            context_parts.append(f"Perfil do cliente: {json.dumps(context['user_profile'], ensure_ascii=False)}")
        
        return "\n".join(context_parts)
    
    def _enhance_response_with_persuasion(self, response: str, intent_analysis: Dict, web_data: Optional[Dict]) -> str:
        """Adiciona elementos persuasivos à resposta"""
        enhanced_response = response
        
        buying_stage = intent_analysis.get("buying_stage", "consideration")
        if buying_stage == "decision" and not self._has_cta(response):
            enhanced_response += self._generate_cta(intent_analysis)
        
        if intent_analysis.get("emotional_state") == "skeptical":
            enhanced_response = self._add_social_proof(enhanced_response)
        
        urgency = intent_analysis.get("urgency_level", "medium")
        if urgency == "low" and buying_stage in ["consideration", "decision"]:
            enhanced_response = self._add_urgency_element(enhanced_response)
        
        return enhanced_response
    
    def _has_cta(self, response: str) -> bool:
        """Verifica se a resposta já tem uma chamada para ação"""
        cta_indicators = [
            "clique", "acesse", "compre", "adquira", "garanta", "aproveite",
            "entre em contato", "fale conosco", "solicite", "peça"
        ]
        return any(indicator in response.lower() for indicator in cta_indicators)
    
    def _generate_cta(self, intent_analysis: Dict) -> str:
        """Gera chamada para ação apropriada"""
        ctas = [
            "\n\n🎯 Que tal darmos o próximo passo? Posso te ajudar com mais detalhes agora mesmo!",
            "\n\n✨ Vamos transformar esse interesse em realidade? Estou aqui para te guiar!",
            "\n\n🚀 Pronto para começar? Vou te mostrar exatamente como proceder!"
        ]
        return ctas[hash(str(intent_analysis)) % len(ctas)]
    
    def _add_social_proof(self, response: str) -> str:
        """Adiciona prova social à resposta"""
        social_proofs = [
            "\n\nAliás, mais de 95% dos nossos clientes ficam completamente satisfeitos com os resultados!",
            "\n\nVocê sabia que já ajudamos milhares de pessoas como você a alcançar seus objetivos?",
            "\n\nNossos clientes sempre comentam como essa foi uma das melhores decisões que tomaram!"
        ]
        return response + social_proofs[len(response) % len(social_proofs)]
    
    def _add_urgency_element(self, response: str) -> str:
        """Adiciona elemento de urgência à resposta"""
        urgency_elements = [
            "\n\n⏰ Aproveite que estou online agora para te atender com toda atenção!",
            "\n\n🔥 Esse é o momento perfeito para agir - as condições estão ideais!",
            "\n\n💎 Oportunidades como essa não aparecem todos os dias!"
        ]
        return response + urgency_elements[len(response) % len(urgency_elements)]
    
    def _get_fallback_response(self, intent: str) -> str:
        """Retorna resposta de fallback em caso de erro"""
        fallbacks = {
            "greeting": "Olá! É um prazer falar com você! Como posso te ajudar hoje? 😊",
            "objection": "Entendo sua preocupação, e é completamente normal ter essas dúvidas. Deixe-me esclarecer isso para você...",
            "question": "Excelente pergunta! Vou te dar uma resposta completa e detalhada...",
            "other": "Que interessante! Conte-me mais sobre isso para que eu possa te ajudar da melhor forma possível!"
        }
        return fallbacks.get(intent, fallbacks["other"])
    
    def update_conversation_history(self, session_id: str, user_message: str, bot_response: str, context: Dict):
        """Atualiza histórico da conversa"""
        if session_id not in self.conversation_history:
            self.conversation_history[session_id] = []
        
        self.conversation_history[session_id].append({
            "timestamp": datetime.now().isoformat(),
            "user_message": user_message,
            "bot_response": bot_response,
            "context": context
        })
        
        if len(self.conversation_history[session_id]) > 20:
            self.conversation_history[session_id] = self.conversation_history[session_id][-20:]
    
    def get_conversation_context(self, session_id: str) -> Dict:
        """Recupera contexto da conversa"""
        history = self.conversation_history.get(session_id, [])
        return {
            "previous_messages": [
                {"user": msg["user_message"], "bot": msg["bot_response"]} 
                for msg in history[-10:]
            ],
            "session_start": history[0]["timestamp"] if history else datetime.now().isoformat(),
            "total_interactions": len(history)
        }

    def _post_process_response(self, response: str) -> str:
        """Garante que a resposta seja curta e termine com uma pergunta."""
        sentences = re.split(r'(?<=[.!?])\s+', response)
        
        if len(sentences) > 2:
            response = '. '.join(sentences[:2]) + '.'
        
        if not re.search(r'[?]$', response.strip()):
            # Se não terminar com pergunta, adiciona uma pergunta para manter o fluxo
            if len(sentences) == 1:
                response += " Posso te ajudar com algo mais?"
            else:
                response += " O que mais você gostaria de saber?"
            
        return response


