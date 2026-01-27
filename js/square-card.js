(function($, ts) {
  // Square Payment Script
  var script = {
    name: 'square',
    payments: null,
    card: null,
    scriptLoading: false,
    squareApplicationId: window.squareApplicationId,
    squareLocationId: window.squareLocationId,
    squareProcessorId: window.squareProcessorId,
    squareContactId: window.squareContactId,

    /**
     * Debug logging function
     * @param {string} message
     */
    debugging: function(message) {
      if (typeof CRM !== 'undefined' && CRM.squarePayment && CRM.squarePayment.debugging) {
        CRM.squarePayment.debugging(script.name, message);
      } else {
        console.log(`[Square Debug] ${message}`);
      }
    },

    /**
     * Check if this is a Drupal Webform
     * @returns {boolean}
     */
    getIsDrupalWebform: function() {
      return typeof CRM !== 'undefined' && CRM.squarePayment && CRM.squarePayment.getIsDrupalWebform
        ? CRM.squarePayment.getIsDrupalWebform()
        : document.querySelector('form.webform-submission-form') !== null;
    },

    /**
     * Initialize Square Payments
     * @returns {Promise}
     */
    initializePayments: async function() {
      if (!script.squareApplicationId || !script.squareLocationId) {
        script.debugging('Missing Square configuration');
        return false;
      }

      try {
        script.payments = Square.payments(script.squareApplicationId, script.squareLocationId);
        script.card = await script.payments.card();
        await script.card.attach('#square-card-container');

        script.debugging('Square card element initialized');
        return true;
      } catch (error) {
        script.debugging('Square initialization error: ' + error.message);
        return false;
      }
    },

    /**
     * Handle form submission for Square payment
     * @param {Event} e - Form submission event
     */
    handleSubmit: async function(e) {
      // Prevent default form submission
      e.preventDefault();
      e.stopImmediatePropagation();

      // Check if we need to skip Square processing
      if (script.shouldSkipSquareProcessing()) {
        return true;
      }

      try {
        // Tokenize the card
        const result = await script.card.tokenize();
        console.log(result);
        if (result.status !== 'OK') {
          alert("Card could not be tokenized.");
          return false;
        }
        console.log('Card tokenized successfully: ' + result.token);
        // Exchange token with Civi
        const response = await fetch(CRM.url('civicrm/square/token'), {
          method: 'POST',
          headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({
            token: result.token,
            processor_id: script.squareProcessorId,
            contact_id: script.squareContactId,
          }),
        });
        console.log(response);
        const json = await response.json();
        console.log(json);
        if (!json.success) {
          alert("Could not store card: " + json.error);
          return false;
        }

        // Store Civi token in hidden field
        const hiddenTokenField = document.querySelector('#square_payment_token');
        if (hiddenTokenField) {
          hiddenTokenField.value = json.civi_token;
        }
        // Submit the form
        script.submitForm();
        return true;
      } catch (error) {
        script.debugging('Square payment processing error: ' + error.message);
        alert('Payment processing failed: ' + error.message);
        return false;
      }
    },

    /**
     * Determine if Square processing should be skipped
     * @returns {boolean}
     */
    shouldSkipSquareProcessing: function() {
      // Skip if total amount is zero
      const totalAmount = script.getTotalAmount();
      if (totalAmount === 0.0) {
        script.debugging("Total amount is 0, skipping Square processing");
        return true;
      }

      // Drupal Webform specific checks
      if (script.getIsDrupalWebform()) {
        // Check if billing block is hidden
        if ($('#billing-payment-block').is(':hidden')) {
          script.debugging('No payment processor on webform');
          return true;
        }

        // Check processor selection if multiple processors available
        const $processorFields = $('[name="submitted[civicrm_1_contribution_1_contribution_payment_processor_id]"]');
        if ($processorFields.length) {
          if ($processorFields.filter(':checked').val() === '0' || $processorFields.filter(':checked').val() === 0) {
            script.debugging('No payment processor selected');
            return true;
          }
        }
      }

      return false;
    },

    /**
     * Get total amount from CRM or form
     * @returns {number}
     */
    getTotalAmount: function() {
      return typeof CRM !== 'undefined' && CRM.squarePayment && CRM.squarePayment.getTotalAmount
        ? CRM.squarePayment.getTotalAmount()
        : parseFloat(document.querySelector('[name="total_amount"]')?.value || 0);
    },

    /**
     * Submit the form
     */
    submitForm: function() {
      if (typeof CRM !== 'undefined' && CRM.squarePayment && CRM.squarePayment.form) {
        CRM.squarePayment.form.submit();
      } else {
        const form = document.querySelector('form#Main');
        if (form) {
          form.submit();
        }
      }
    },

    /**
     * Register this script with CRM payment
     */
    registerScript: function() {
      if (typeof CRM !== 'undefined' && CRM.squarePayment && CRM.squarePayment.registerScript) {
        CRM.squarePayment.registerScript(script.name);
      }
    },

    /**
     * Initialize the script
     */
    init: async function() {
      script.debugging('Initializing Square Payment Script');

      // Register the script
      script.registerScript();

      // Initialize Square Payments
      const initialized = await script.initializePayments();
      if (!initialized) {
        return;
      }

      // Find the form and attach submit event
      const form = document.querySelector('form#Main');
      if (form) {
        form.addEventListener('submit', script.handleSubmit);
      }
    }
  };

  // Initialize the script on DOM Content Loaded
  document.addEventListener('DOMContentLoaded', script.init);

  // If CRM Payment object exists, expose this script
  if (typeof CRM !== 'undefined' && CRM.squarePayment) {
    var crmPaymentObject = {};
    crmPaymentObject[script.name] = script;
    $.extend(CRM.squarePayment, crmPaymentObject);
  }
}(CRM.$, CRM.ts('org.uschess.square')));