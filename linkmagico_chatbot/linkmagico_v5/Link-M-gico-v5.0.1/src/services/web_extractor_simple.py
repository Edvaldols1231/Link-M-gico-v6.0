import requests
from bs4 import BeautifulSoup
import json
import re
import time
import logging
from typing import Dict, List, Optional
from urllib.parse import urljoin, urlparse

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SimpleWebExtractor:
    """Extrator web simplificado para testes"""
    
    def __init__(self):
        self.session = requests.Session()
        self.setup_headers()
        
    def setup_headers(self):
        """Configura headers para parecer um navegador real"""
        self.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive'
        }
        self.session.headers.update(self.headers)
    
    def extract_data(self, url: str, method: str = "requests") -> Dict:
        """Extrai dados de uma URL usando requests simples"""
        try:
            logger.info(f"Extraindo dados de: {url}")
            
            response = self.session.get(url, timeout=15)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            return self._parse_html_content(soup, url, "requests")
            
        except Exception as e:
            logger.error(f"Erro na extração de {url}: {e}")
            return self._create_error_response(url, str(e))
    
    def _parse_html_content(self, soup: BeautifulSoup, url: str, method: str) -> Dict:
        """Analisa e extrai dados básicos do HTML"""
        try:
            extracted_data = {
                "url": url,
                "method": method,
                "timestamp": time.time(),
                "success": True,
                "data": {}
            }
            
            # Metadados básicos
            extracted_data["data"]["title"] = self._extract_title(soup)
            extracted_data["data"]["description"] = self._extract_description(soup)
            
            # Conteúdo principal
            extracted_data["data"]["main_content"] = self._extract_main_content(soup)
            extracted_data["data"]["clean_text"] = self._extract_clean_text(soup)
            
            # Links básicos
            extracted_data["data"]["links"] = self._extract_links(soup, url)
            
            # Informações de contato básicas
            extracted_data["data"]["contact_info"] = self._extract_contact_info(soup)
            
            return extracted_data
            
        except Exception as e:
            logger.error(f"Erro no parsing de {url}: {e}")
            return self._create_error_response(url, str(e))
    
    def _extract_title(self, soup: BeautifulSoup) -> str:
        """Extrai título da página"""
        title_tag = soup.find('title')
        if title_tag:
            return title_tag.get_text().strip()
        
        h1 = soup.find('h1')
        if h1:
            return h1.get_text().strip()
        
        return ""
    
    def _extract_description(self, soup: BeautifulSoup) -> str:
        """Extrai descrição da página"""
        meta_desc = soup.find('meta', attrs={'name': 'description'})
        if meta_desc and meta_desc.get('content'):
            return meta_desc['content'].strip()
        
        first_p = soup.find('p')
        if first_p:
            return first_p.get_text().strip()[:200]
        
        return ""
    
    def _extract_main_content(self, soup: BeautifulSoup) -> str:
        """Extrai conteúdo principal da página"""
        main_selectors = ['main', 'article', '.content', '#content']
        
        for selector in main_selectors:
            element = soup.select_one(selector)
            if element:
                return element.get_text().strip()
        
        # Fallback: remove elementos não relacionados ao conteúdo
        content_soup = soup.find('body')
        if content_soup:
            for tag in content_soup.find_all(['script', 'style', 'nav', 'header', 'footer']):
                tag.decompose()
            
            return content_soup.get_text().strip()
        
        return soup.get_text().strip()
    
    def _extract_clean_text(self, soup: BeautifulSoup) -> str:
        """Extrai texto limpo da página"""
        # Remove scripts, styles, etc.
        for script in soup(["script", "style", "nav", "header", "footer"]):
            script.decompose()
        
        text = soup.get_text()
        
        # Limpa o texto
        lines = (line.strip() for line in text.splitlines())
        chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
        text = ' '.join(chunk for chunk in chunks if chunk)
        
        return text
    
    def _extract_links(self, soup: BeautifulSoup, base_url: str) -> List[Dict]:
        """Extrai links básicos"""
        links = []
        for link in soup.find_all('a', href=True)[:10]:  # Limita a 10 links
            href = link['href']
            absolute_url = urljoin(base_url, href)
            links.append({
                'text': link.get_text().strip(),
                'url': absolute_url
            })
        
        return links
    
    def _extract_contact_info(self, soup: BeautifulSoup) -> Dict:
        """Extrai informações de contato básicas"""
        contact_info = {
            'emails': [],
            'phones': []
        }
        
        text = soup.get_text()
        
        # Emails
        email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'
        contact_info['emails'] = list(set(re.findall(email_pattern, text)))[:3]
        
        # Telefones
        phone_pattern = r'(\(?\d{2}\)?\s?\d{4,5}-?\d{4})'
        contact_info['phones'] = list(set(re.findall(phone_pattern, text)))[:3]
        
        return contact_info
    
    def _create_error_response(self, url: str, error: str) -> Dict:
        """Cria resposta de erro"""
        return {
            "url": url,
            "method": "requests",
            "timestamp": time.time(),
            "success": False,
            "error": error,
            "data": {}
        }

# Alias para compatibilidade
UniversalWebExtractor = SimpleWebExtractor

