(function ($, CRM) {
  $(function () {
    if (!CRM || !CRM.vars || !CRM.vars.orgUschessSquare) {
      return;
    }

    var cfg = CRM.vars.orgUschessSquare;
    if (!cfg.applicationId || !cfg.locationId) {
      console.error('Square config missing applicationId or locationId');
      return;
    }

    // Find the main form (front-end contribution or event form).
    var $form = $('form#Main, form.CRM_Contribute_Form_Contribution, form.CRM_Event_Form_Registration').first();
    if (!$form.length) {
      return;
    }

    var payments = null;
    var card = null;
    var initializing = false;

    async function initSquare() {
      if (initializing) {
        return;
      }
      initializing = true;

      try {
        // Square global is provided by the SDK.
        payments = window.Square && window.Square.payments
          ? window.Square.payments(cfg.applicationId, cfg.locationId)
          : null;

        if (!payments) {
          throw new Error('Square.payments API not available on page.');
        }

        card = await payments.card();
        await card.attach('#square-card-container');
      } catch (e) {
        console.error('Failed to initialize Square Web Payments SDK', e);
        $('#square-card-errors')
          .text('Unable to load secure card entry. Please try again later or contact support.')
          .show();
      }
    }

    // Initialise card UI.
    initSquare();

    async function tokenizeAndSubmit(event) {
      if (!card) {
        // If card is not initialised, let the normal submit happen so
        // server-side validation can show a sensible error.
        return;
      }

      event.preventDefault();

      var $error = $('#square-card-errors');
      $error.hide().text('');

      try {
        var result = await card.tokenize();

        if (!result || result.status !== 'OK') {
          // Some kind of card error.
          var message = 'Your card could not be processed. Please check your details.';
          if (result && result.errors && result.errors.length) {
            // Show first error message if available.
            message = result.errors[0].message || message;
          }
          $error.text(message).show();
          return;
        }

        var nonce = result.token;
        if (!nonce) {
          $error.text('Missing card token from Square. Please try again.').show();
          return;
        }

        // Put token into hidden field for CiviCRM to pick up.
        $('#square-payment-token').val(nonce);

        // Optional AJAX round-trip – allows future server-side checks / transforms
        // without changing our front-end logic.
        if (cfg.ajaxUrl) {
          try {
            var ajaxResp = await $.ajax({
              url: cfg.ajaxUrl,
              type: 'POST',
              dataType: 'json',
              data: {
                class_name: 'CRM_UschessSquare_Ajax_SquareToken',
                fn_name: 'tokenize',
                token: nonce
              }
            });

            if (ajaxResp && ajaxResp.is_error) {
              $error
                .text(ajaxResp.error_message || 'Card processing failed. Please try again.')
                .show();
              return;
            }

            if (ajaxResp && ajaxResp.token) {
              // If server returns a transformed token, use that.
              $('#square-payment-token').val(ajaxResp.token);
            }
          } catch (xhrErr) {
            console.error('Square token AJAX error', xhrErr);
            $error
              .text('An error occurred while processing your card. Please try again.')
              .show();
            return;
          }
        }

        // All good: unbind our handler and submit for real.
        $form.off('submit.square');
        $form.trigger('submit');

      } catch (e) {
        console.error('Unexpected error during Square tokenize', e);
        $error
          .text('Unexpected error processing your card. Please try again.')
          .show();
      }
    }

    // Attach submit handler (namespaced so we can remove it).
    $form.on('submit.square', tokenizeAndSubmit);
  });
})(CRM.$, CRM);