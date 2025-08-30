from flask import Flask, request, jsonify
import sys
sys.path.insert(0, '/home/ubuntu/upload/chatbot_project/Link-M-gico-v5.0.1/src')
from services.web_extractor import UniversalWebExtractor

app = Flask(__name__)
web_extractor = UniversalWebExtractor()

@app.route('/extract', methods=['POST'])
def extract():
    data = request.get_json()
    url = data.get('url')
    if not url:
        return jsonify({'error': 'URL is required'}), 400
    
    extracted_data = web_extractor.extract_data(url)
    return jsonify(extracted_data)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=10001, debug=True)


