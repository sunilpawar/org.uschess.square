(async function() {
    if (typeof window.squareApplicationId === 'undefined') return;
  
    const payments = Square.payments(window.squareApplicationId, window.squareLocationId);
  
    const card = await payments.card();
    await card.attach('#square-card-container');
  
    const form = document.querySelector('form#Main');
    if (!form) return;
  
    form.addEventListener('submit', async function (e) {
        const result = await card.tokenize();
        if (result.status !== 'OK') {
          e.preventDefault();
          alert("Card could not be tokenized.");
          return;
        }
      
        // Exchange token → Civi token
        const response = await fetch(CRM.url('civicrm/square/token'), {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({
            token: result.token,
            processor_id: window.squareProcessorId,
            cid: window.squareContactId,
          }),
        });
      
        const json = await response.json();
        if (!json.success) {
          e.preventDefault();
          alert("Could not store card: " + json.error);
          return;
        }
      
        // Store Civi token in hidden field
        document.querySelector('#square_payment_token').value = json.civi_token;
      });
  })();