
// ENFORCE CONCISE DEFAULT: helper to ensure concise instructions
function ensureConcise(custom) {
  const hint = 'Responda em até 3 frases; seja direto e objetivo.';
  if (!custom) return hint;
  if (!custom.includes('Responda em')) return custom.trim() + ' ' + hint;
  return custom;
}

document.addEventListener('DOMContentLoaded', function() {
    const chatbotForm = document.getElementById('chatbotForm');
    const loadingDiv = document.getElementById('loading');
    const resultDiv = document.getElementById('result');
    const extractedDataP = document.querySelector('.extracted-data p');

    chatbotForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const robotName = document.getElementById('robotName').value;
        const salesUrl = document.getElementById('salesUrl').value;
        const customInstructions = document.getElementById('customInstructions').value;

        loadingDiv.style.display = 'block';
        resultDiv.style.display = 'none';

        try {
            const response = await fetch('/extract', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    url: salesUrl,
                    instructions: ensureConcise(customInstructions)
                })
            });
	
            const data = await response.json();

            if (data.success) {
                const summary = data.data.summary;
                extractedDataP.innerHTML = `<strong>Resumo:</strong> ${summary}`;
                resultDiv.style.display = 'block';
            } else {
                extractedDataP.innerHTML = `<strong>Erro:</strong> ${data.error}`;
                resultDiv.style.display = 'block';
            }
        } catch (error) {
            extractedDataP.innerHTML = `<strong>Erro:</strong> ${error.message}`;
            resultDiv.style.display = 'block';
        } finally {
            loadingDiv.style.display = 'none';
        }
    });
});


