(function ($, CRM) {
  // Initialize as soon as DOM is ready, before other scripts
  $(document).ready(function() {
    initSquarePayments();
  });

  function initSquarePayments() {
    
    // Try to get config from window variables first (more reliable)
    var appId = window.squareApplicationId;
    var locationId = window.squareLocationId;
    
    // Fall back to CRM.vars if window variables not set
    if (!appId || !locationId) {
      console.log('Square.js: Window variables not found, trying CRM.vars');
      if (!CRM || !CRM.vars || !CRM.vars.orgUschessSquare) {
        console.warn('Square.js: CRM.vars.orgUschessSquare not found');
        return;
      }
      var cfg = CRM.vars.orgUschessSquare;
      appId = cfg.applicationId;
      locationId = cfg.locationId;
    }
    
    if (!appId || !locationId) {
      console.error('Square config missing applicationId or locationId');
      return;
    }

    // Find the main form - try multiple selectors
    var $form = $('form#Main').length ? $('form#Main') : 
                $('form.CRM_Contribute_Form_Contribution').length ? $('form.CRM_Contribute_Form_Contribution') :
                $('form.CRM_Event_Form_Registration').length ? $('form.CRM_Event_Form_Registration') :
                $('form[id*="Contribution"]').first();
    
    if (!$form.length) {
      console.warn('Square.js: No form found, trying all forms');
      $form = $('form').first();
      if (!$form.length) {
        console.error('Square.js: No form found at all');
        return;
      }
    }
    // Check if card container exists
    if (!$('#square-card-container').length) {
      console.warn('Square.js: Card container not found');
      return;
    }
    console.log('Square.js: Card container found');
    
    // Verify token field exists
    var $tokenField = $('#square_payment_token');
    if (!$tokenField.length) {
      console.error('Square.js: Token field #square_payment_token not found');
      return;
    }
    console.log('Square.js: Token field found');

    var payments = null;
    var card = null;
    var initializing = false;
    var tokenized = false;

    async function initSquare() {
      if (initializing) {
        return;
      }
      initializing = true;

      try {
        // Square global is provided by the SDK.
        if (!window.Square || !window.Square.payments) {
          throw new Error('Square.payments API not available on page.');
        }
        payments = window.Square.payments(appId, locationId);

        if (!payments) {
          throw new Error('Failed to initialize Square payments.');
        }
        card = await payments.card();
        await card.attach('#square-card-container');
      } catch (e) {
        $('#square-card-errors')
          .text('Unable to load secure card entry. Please try again later or contact support.')
          .show();
      }
    }

    // Initialize card UI.
    initSquare();
    async function tokenizeAndSubmit(event) {
      
      // If already tokenized, allow normal submission
      if (tokenized) {
        return true;
      }

      // If card is not initialized, let normal submit happen for server-side validation
      if (!card) {
        return true;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      var $error = $('#square-card-errors');
      $error.hide().text('');

      try {
        var result = await card.tokenize();
        if (!result || result.status !== 'OK') {
          var message = 'Your card could not be processed. Please check your details.';
          if (result && result.errors && result.errors.length) {
            message = result.errors[0].message || message;
          }
          console.error('Square.js: Tokenization failed', message);
          $error.text(message).show();
          return false;
        }

        var nonce = result.token;
        if (!nonce) {
          $error.text('Missing card token from Square. Please try again.').show();
          return false;
        }

        // Put token into hidden field for CiviCRM to pick up.
        var $tokenField = $('#square_payment_token');
        $tokenField.val(nonce);

        // Mark as tokenized so next submit goes through
        tokenized = true;

        // Submit the form
        $form.off('submit.square');
        $form.submit();

      } catch (e) {
        $error
          .text('Unexpected error processing your card. Please try again.')
          .show();
        return false;
      }
    }

    // Attach submit handler FIRST (before other handlers)
    // Use 'on' with higher priority to intercept before CiviCRM's handlers
    $form.on('submit', async function(event) {
      
      // If already tokenized, allow normal submission
      if (tokenized) {
        return true;
      }

      // If card is not initialized, let normal submit happen
      if (!card) {
        console.log('Square.js: Card not initialized, allowing normal submission');
        return true;
      }

      // Prevent default submission and tokenize
      console.log('Square.js: Preventing default submission to tokenize');
      event.preventDefault();
      event.stopImmediatePropagation();
      
      // Call tokenization and wait for it
      await tokenizeAndSubmit(event);
      return false;
    });
  }
})(CRM.$, CRM);