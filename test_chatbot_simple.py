#!/usr/bin/env python3
"""
Script de teste simples para o chatbot aprimorado
"""

import requests
import json
import time
import sys

# Configurações
BASE_URL = "http://localhost:5000"
ENHANCED_CHAT_URL = f"{BASE_URL}/api/chatbot/enhanced/chat"
HEALTH_URL = f"{BASE_URL}/api/health"

def test_health_check():
    """Testa o health check"""
    print("🔍 Testando health check...")
    try:
        response = requests.get(HEALTH_URL, timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Health check OK - Status: {data.get('status')}")
            print(f"   Versão: {data.get('version')}")
            return True
        else:
            print(f"❌ Health check falhou - Status: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Erro no health check: {e}")
        return False

def test_enhanced_chat(message, session_id=None):
    """Testa o chat aprimorado"""
    print(f"💬 Testando chat: '{message}'")
    
    payload = {
        "message": message,
        "session_id": session_id
    }
    
    try:
        response = requests.post(ENHANCED_CHAT_URL, json=payload, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('success'):
                print(f"✅ Resposta recebida:")
                print(f"   Bot: {data.get('response')}")
                print(f"   Session ID: {data.get('session_id')}")
                
                context = data.get('conversation_context', {})
                print(f"   Estágio: {context.get('stage')}")
                print(f"   Estado emocional: {context.get('emotional_state')}")
                print(f"   Engajamento: {context.get('engagement_level', 0):.2f}")
                print(f"   Confiança: {context.get('trust_level', 0):.2f}")
                print(f"   Prontidão compra: {context.get('purchase_readiness', 0):.2f}")
                
                return data.get('session_id'), True
            else:
                print(f"❌ Chat falhou: {data.get('error')}")
                return None, False
        else:
            print(f"❌ Erro HTTP {response.status_code}: {response.text}")
            return None, False
            
    except Exception as e:
        print(f"❌ Erro no chat: {e}")
        return None, False

def run_conversation_test():
    """Executa uma conversa de teste completa"""
    print("\n🚀 Iniciando teste de conversa completa...")
    
    # Cenário de teste: Cliente interessado em chatbot para e-commerce
    conversation_flow = [
        "Olá, boa tarde!",
        "Estou procurando uma solução de chatbot para minha loja online",
        "Tenho uma loja de roupas e quero melhorar o atendimento",
        "Quantos clientes vocês conseguem atender ao mesmo tempo?",
        "E quanto custa essa solução?",
        "Parece interessante, mas preciso pensar melhor",
        "Vocês têm casos de sucesso de outras lojas?",
        "Ok, quero saber mais sobre como implementar"
    ]
    
    session_id = None
    success_count = 0
    
    for i, message in enumerate(conversation_flow, 1):
        print(f"\n--- Interação {i} ---")
        session_id, success = test_enhanced_chat(message, session_id)
        
        if success:
            success_count += 1
        
        # Pausa entre mensagens para simular conversa real
        time.sleep(2)
    
    print(f"\n📊 Resultado do teste:")
    print(f"   Sucessos: {success_count}/{len(conversation_flow)}")
    print(f"   Taxa de sucesso: {(success_count/len(conversation_flow)*100):.1f}%")
    
    return success_count == len(conversation_flow)

def main():
    """Função principal"""
    print("🤖 Teste do LinkMágico Chatbot Enhanced")
    print("=" * 50)
    
    # 1. Testa health check
    if not test_health_check():
        print("❌ Servidor não está respondendo. Verifique se está rodando.")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    
    # 2. Testa chat simples
    print("💬 Teste de chat simples...")
    session_id, success = test_enhanced_chat("Olá, como você pode me ajudar?")
    
    if not success:
        print("❌ Teste de chat simples falhou.")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    
    # 3. Testa conversa completa
    if run_conversation_test():
        print("\n🎉 Todos os testes passaram com sucesso!")
        print("✅ O chatbot aprimorado está funcionando corretamente.")
    else:
        print("\n⚠️  Alguns testes falharam.")
        print("🔧 Verifique os logs para mais detalhes.")

if __name__ == "__main__":
    main()

