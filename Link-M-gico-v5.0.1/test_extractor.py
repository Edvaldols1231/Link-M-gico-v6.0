import sys
sys.path.insert(0, '/home/ubuntu/upload/chatbot_project/Link-M-gico-v5.0.1/src')
from services.web_extractor import UniversalWebExtractor

url = "https://link-m-gico-v6-0-dcau.onrender.com"
extractor = UniversalWebExtractor()
result = extractor.extract_data(url)
print(result)
