/*jshint esversion: 6 */
(function($, ts) {
  var payment = {
    x: 'CRM.squarePayment',
    form: null,
    submitButtons: null,
    scripts: {},

    /**
     * Get the total amount on the form
     * @returns {number}
     */
    getTotalAmount: function() {
      var totalAmount = 0.0;
      if (this.getIsDrupalWebform()) {
        // This is how webform civicrm calculates the amount in webform_civicrm_payment.js
        $('.line-item:visible', '#wf-crm-billing-items').each(function() {
          totalAmount += parseFloat($(this).data('amount'));
        });
      }
      else if (typeof calculateTotalFee == 'function') {
          // This is ONLY triggered in the following circumstances on a CiviCRM contribution page:
          // - With a priceset that allows a 0 amount to be selected.
          // - When we are the ONLY payment processor configured on the page.
          // It is ALSO replaced by percentagepricesetfield and extrafee extensions
          totalAmount = parseFloat(calculateTotalFee());
        }
      else if (document.getElementById('totalTaxAmount') !== null) {
        totalAmount = this.calculateTaxAmount();
        this.debugging(this.name, 'Calculated amount using internal calculateTaxAmount()');
      }
      else if ($("#priceset [price]").length > 0) {
        // This is ONLY triggered in the following circumstances on a CiviCRM contribution page:
        // - With a priceset that allows a 0 amount to be selected.
        // - When we are the ONLY payment processor configured on the page.
        $("#priceset [price]").each(function () {
          totalAmount = totalAmount + $(this).data('line_raw_total');
        });
      }
      else if (document.getElementById('total_amount')) {
        // The input#total_amount field exists on backend contribution forms
        totalAmount = parseFloat(document.getElementById('total_amount').value);
      }
      if (this.isEventAdditionalParticipants()) {
        // The amount shown on the initial page is the total amount for 1 registration.
        // It is "impossible" to calculate the total amount because we don't know what will be selected
        // for each additional participant.
        // Set totalAmount = null to force the use of a setupIntent
        if (CRM.vars.cividiscount !== undefined && CRM.vars.cividiscount.discountApplied && CRM.vars.cividiscount.totalAmountZero) {
          // Special case for CiviDiscount and 100% discount. We know that total will be zero for all participants
          // Setting this to 0.0 means the stripe element will not be loaded or validated.
          totalAmount = 0.0;
        }
        else {
          // Force a setupIntent because we don't know the total amount
          totalAmount = null;
        }
      }
      this.debugging(this.name, 'getTotalAmount: ' + totalAmount);
      return totalAmount;
    },

    /**
     * This is calculated in CRM/Contribute/Form/Contribution.tpl and is used to calculate the total
     *   amount with tax on backend submit contribution forms.
     *   The only way we can get the amount is by parsing the text field and extracting the final bit after the space.
     *   eg. "Amount including Tax: $ 4.50" gives us 4.50.
     *   The PHP side is responsible for converting money formats (we just parse to cents and remove any ,. chars).
     *
     * @returns {float}
     */
    calculateTaxAmount: function() {
      var totalTaxAmount = 0;
      if (document.getElementById('totalTaxAmount') === null) {
        return totalTaxAmount;
      }

      // If tax and invoicing is disabled totalTaxAmount div exists but is empty
      if (document.getElementById('totalTaxAmount').textContent.length === 0) {
        totalTaxAmount = document.getElementById('total_amount').value;
      }
      else {
        // Otherwise totalTaxAmount div contains a textual amount including currency symbol

        // Use the "separator" variable declared in Contribution.tpl or default to . for decimal point
        var dPoint = (typeof separator !== 'undefined') && separator || '.';

        // Regular expression to comb for numeric parts of the totalTaxAmount div.
        var matcher = new RegExp('\\d{1,3}(' + dPoint.replace(/\W/g, '\\$&') + '\\d{0,2})?', 'g');

        // Join all parts and ensure the decimal point is per javascript format.
        totalTaxAmount = document.getElementById('totalTaxAmount').textContent.match(matcher).join('').replace(dPoint, '.');
      }
      totalTaxAmount = parseFloat(totalTaxAmount);
      if (isNaN(totalTaxAmount)) {
        totalTaxAmount = 0.0;
      }
      return totalTaxAmount;
    },

    /**
     * Get currency on the form
     * @param defaultCurrency
     * @returns {string}
     */
    getCurrency: function(defaultCurrency) {
      var currency = defaultCurrency;
      if (this.form.querySelector('#currency')) {
        currency = this.form.querySelector('#currency').value;
      }
      this.debugging(this.name, 'Currency is: ' + currency);
      return currency;
    },

    /**
     * Is the event registering additional participants (this means we do not know the full amount)
     *
     * @returns {boolean}
     */
    isEventAdditionalParticipants: function() {
      if ((document.getElementById('additional_participants') !== null) &&
        (document.getElementById('additional_participants').value.length !== 0)) {
        this.debugging(this.name, 'Event has additional participants');
        return true;
      }
      return false;
    },

    /**
     * Are we currently loaded on a drupal webform?
     *
     * @returns {boolean}
     */
    getIsDrupalWebform: function() {
      // form class for drupal webform: webform-client-form (drupal 7); webform-submission-form (drupal 8)
      if (this.form !== null) {
        return this.form.classList.contains('webform-client-form') || this.form.classList.contains('webform-submission-form');
      }
      return false;
    },

    /**
     * Get the Billing Form as a DOM/HTMLElement.
     * Also set the "form" property on CRM.squarePayment.
     *
     * @returns {HTMLElement}
     */
    getBillingForm: function() {
      // If we have a billing form on the page with our processor
      var billingFormID = $('div#crm-payment-js-billing-form-container').closest('form').attr('id');
      if ((typeof billingFormID === 'undefined') || (!billingFormID.length)) {
        // If we have multiple payment processors to select and we are not currently loaded
        billingFormID = $('input[name=hidden_processor]').closest('form').prop('id');
      }
      if (typeof billingFormID === 'undefined' || (!billingFormID.length)) {
        billingFormID = $('div#billing-payment-block').closest('form').prop('id');
      }
      if (typeof billingFormID === 'undefined' || (!billingFormID.length)) {
        this.debugging(this.name, 'no billing form');
        this.form = null;
        return this.form;
      }
      // We have to use document.getElementById here so we have the right elementtype for appendChild()
      this.form = document.getElementById(billingFormID);
      return this.form;
    },

    /**
     * Get all the billing submit buttons on the form as DOM elements
     * Also set the "submitButtons" property on CRM.squarePayment.
     *
     * @returns {NodeList}
     */
    getBillingSubmit: function() {
      if (CRM.squarePayment.getIsDrupalWebform()) {
        this.submitButtons = this.form.querySelectorAll('[type="submit"].webform-submit');
        if (this.submitButtons.length === 0) {
          // drupal 8 webform
          this.submitButtons = this.form.querySelectorAll('[type="submit"].webform-button--submit');
        }
      }
      else {
        this.submitButtons = this.form.querySelectorAll('[type="submit"].validate');
      }
      if (this.submitButtons.length === 0) {
        this.debugging(this.name, 'No submit button found!');
      }
      return this.submitButtons;
    },

    /**
     * Are we creating a recurring contribution?
     * @returns {boolean}
     */
    getIsRecur: function() {
      if (!this.supportsRecur()) {
        return false;
      }
      var isRecur = false;
      // Auto-renew contributions for CiviCRM Webforms.
      if (this.getIsDrupalWebform()) {
        if (($('input[data-civicrm-field-key$="contribution_installments"]').length !== 0 && $('input[data-civicrm-field-key$="contribution_installments"]').val() != 1) ||
          ($('input[data-civicrm-field-key$="contribution_frequency_interval"]').length !== 0 && $('input[data-civicrm-field-key$="contribution_frequency_interval"]').val() > 0)
        ) {
          isRecur = true;
        }
      }
      // Auto-renew contributions
      if (document.getElementById('is_recur') !== null) {
        if (document.getElementById('is_recur').type == 'hidden') {
          isRecur = (document.getElementById('is_recur').value == 1);
        }
        else {
          isRecur = Boolean(document.getElementById('is_recur').checked);
        }
      }
      // Auto-renew memberships
      // This gets messy quickly!
      // input[name="auto_renew"] : set to 1 when there is a force-renew membership with no priceset.
      else if ($('input[name="auto_renew"]').length !== 0) {
        if ($('input[name="auto_renew"]').prop('checked')) {
          isRecur = true;
        }
        else if ($('input[name="auto_renew"]').attr('type') == 'hidden') {
          // If the auto_renew field exists as a hidden field, then we force a
          // recurring contribution (the value isn't useful since it depends on
          // the locale - e.g.  "Please renew my membership")
          isRecur = true;
        }
        else {
          isRecur = Boolean($('input[name="auto_renew"]').checked);
        }
      }
      if (!isRecur) {
        // multi-installment pledges are also recurring....
        var is_pledge = $('input[name="is_pledge"]:checked');
        isRecur = is_pledge.length === 1 && parseInt(is_pledge.val()) !== 0 && parseInt($('#pledge_installments').val()) > 1;
      }
      this.debugging(this.name, 'isRecur is ' + isRecur);
      return isRecur;
    },

    /**
     * Does the form support recurring contributions?
     * @returns {boolean}
     */
    supportsRecur: function() {
      var supportsRecur = false;
      // Auto-renew contributions for CiviCRM Webforms.
      if (this.getIsDrupalWebform()) {
        if (($('input[data-civicrm-field-key$="contribution_installments"]').length !== 0) ||
          ($('input[data-civicrm-field-key$="contribution_frequency_interval"]').length !== 0)
        ) {
          supportsRecur = true;
        }
      }
      // Auto-renew contributions
      if (document.getElementById('is_recur') !== null) {
        supportsRecur = true;
      }
      // Auto-renew memberships
      // input[name="auto_renew"] : set to 1 when there is a force-renew membership with no priceset.
      else if ($('input[name="auto_renew"]').length !== 0) {
        supportsRecur = true;
      }
      else if ($('input[name=\'is_pledge\']').length !== 0) {
        // Pledge payments
        supportsRecur = true;
      }
      this.debugging(this.name, 'supportsRecur is ' + supportsRecur);
      return supportsRecur;
    },

    /**
     * Try and get the billing email(s) from the form
     * @returns {string} separated by ;
     */
    getBillingEmail: function() {
      var billingEmail = '';
      $(this.form).find('input[id^=email]').filter(':visible').each(function() { billingEmail += $(this).val() + ';'; });
      return billingEmail;
    },

    /**
     * Try and get the billing contact name from the form
     * @returns {string} separated by ;
     */
    getBillingName: function() {
      var billingName = '';
      $(this.form).find('input#first_name,input#last_name').each(function() { billingName += $(this).val() + ';'; });
      return billingName;
    },

    /**
     * Get the selected payment processor on the form
     * @returns {null|number}
     */
    getPaymentProcessorSelectorValue: function() {
      // Frontend radio selector
      var paymentProcessorSelected = this.form.querySelector('input[name="payment_processor_id"]:checked');
      if (paymentProcessorSelected !== null) {
        return parseInt(paymentProcessorSelected.value);
      }
      else {
        // Backend select dropdown
        paymentProcessorSelected = this.form.querySelector('select[name="payment_processor_id"]');
        if (paymentProcessorSelected !== null) {
          return parseInt(paymentProcessorSelected.value);
        }
      }
      return null;
    },

    /**
     * Is the AJAX request a payment form?
     * @param {string} url
     * @returns {bool}
     */
    isAJAXPaymentForm: function(url) {
      // /civicrm/payment/form? occurs when a payproc is selected on page
      // /civicrm/contact/view/participant occurs when payproc is first loaded on event credit card payment
      // On WordPress these are urlencoded
      var patterns = [
        "(\/|%2F)payment(\/|%2F)form",
        "(\/|\%2F)contact(\/|\%2F)view(\/|\%2F)participant",
        "(\/|\%2F)contact(\/|\%2F)view(\/|\%2F)membership",
        "(\/|\%2F)contact(\/|\%2F)view(\/|\%2F)contribution"
      ];

      if (CRM.config.isFrontend && CRM.vars.payment && CRM.vars.payment.basePage !== 'civicrm') {
        for (const pattern of patterns) {
          if (url.match(CRM.vars.payment.basePage + pattern) !== null) {
            return true;
          }
        }
      }
      for (const pattern of patterns) {
        if (url.match('civicrm' + pattern) !== null) {
          return true;
        }
      }

    },

    /**
     * Call this function before submitting the form to CiviCRM (if you ran setBillingFieldsRequiredForJQueryValidate()).
     * The "name" parameter on a group of checkboxes where at least one must be checked must be the same or validation will require all of them!
     * Reset the name of the checkboxes before submitting otherwise CiviCRM will not get the checkbox values.
     */
    resetBillingFieldsRequiredForJQueryValidate: function() {
      $('div#priceset input[type="checkbox"], fieldset.crm-profile input[type="checkbox"], #on-behalf-block input[type="checkbox"]').each(function() {
        if ($(this).attr('data-name') !== undefined) {
          $(this).attr('name', $(this).attr('data-name'));
        }
      });
    },

    /**
     * Call this function before running jQuery validation
     *
     * CustomField checkboxes in profiles do not get the "required" class.
     * This should be fixed in CRM_Core_BAO_CustomField::addQuickFormElement but requires that the "name" is fixed as well.
     */
    setBillingFieldsRequiredForJQueryValidate: function() {
      $('div.label span.crm-marker').each(function() {
        $(this).closest('div').next('div').find('input[type="checkbox"]').addClass('required');
      });

      // The "name" parameter on a set of checkboxes where at least one must be checked must be the same or validation will require all of them!
      // Checkboxes for custom fields are added as quickform "advcheckbox" which seems to require a unique name for each checkbox. But that breaks
      //   jQuery validation because each checkbox in a required group must have the same name.
      // We store the original name and then change it. resetBillingFieldsRequiredForJQueryValidate() must be called before submit.
      // Most checkboxes get names like: "custom_63[1]" but "onbehalf" checkboxes get "onbehalf[custom_63][1]". We change them to "custom_63" and "onbehalf[custom_63]".
      $('div#priceset input[type="checkbox"], fieldset.crm-profile input[type="checkbox"], #on-behalf-block input[type="checkbox"]').each(function() {
        var name = $(this).attr('name');
        $(this).attr('data-name', name);
        $(this).attr('name', name.replace('[' + name.split('[').pop(), ''));
      });

      // Default email validator accepts test@example but on test@example.org is valid (https://jqueryvalidation.org/jQuery.validator.methods/)
      $.validator.methods.email = function(value, element) {
        // Regex from https://html.spec.whatwg.org/multipage/input.html#valid-e-mail-address
        return this.optional(element) || /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value);
      };
    },

    /**
     * Drupal webform requires a custom element to determine how it should process the submission
     *   or if it should do another action. Because we trigger submit via javascript we have to add this manually.
     * @param submitAction
     */
    addDrupalWebformActionElement: function(submitAction) {
      var hiddenInput = null;
      if (document.getElementById('action') !== null) {
        hiddenInput = document.getElementById('action');
      }
      else {
        hiddenInput = document.createElement('input');
      }
      hiddenInput.setAttribute('type', 'hidden');
      hiddenInput.setAttribute('name', 'op');
      hiddenInput.setAttribute('id', 'action');
      hiddenInput.setAttribute('value', submitAction);
      this.form.appendChild(hiddenInput);
    },

    /**
     * Delegate to standard form submission (we do not submit via our javascript processing).
     * @returns {*}
     */
    doStandardFormSubmit: function() {
      // Disable the submit button to prevent repeated clicks
      for (i = 0; i < this.submitButtons.length; ++i) {
        this.submitButtons[i].setAttribute('disabled', true);
      }
      this.resetBillingFieldsRequiredForJQueryValidate();
      return this.form.submit();
    },

    /**
     * Validate a reCaptcha if it exists on the form.
     * Ideally we would use grecaptcha.getResponse() but the reCaptcha is already
     * render()ed by CiviCRM so we don't have clientID and can't be sure we are
     * checking the reCaptcha that is on our form.
     *
     * @returns {boolean}
     */
    validateReCaptcha: function() {
      if (typeof grecaptcha === 'undefined') {
        // No reCaptcha library loaded
        this.debugging(this.name, 'reCaptcha library not loaded');
        return true;
      }
      if ($(this.form).find('[name=g-recaptcha-response]').length === 0) {
        // no reCaptcha on form - we check this first because there could be reCaptcha on another form on the same page that we don't want to validate
        this.debugging(this.name, 'no reCaptcha on form');
        return true;
      }
      if ($(this.form).find('[name=g-recaptcha-response]').val().length > 0) {
        // We can't use grecaptcha.getResponse because there might be multiple reCaptchas on the page and we might not be the first one.
        this.debugging(this.name, 'recaptcha is valid');
        return true;
      }
      this.debugging(this.name, 'recaptcha active and not valid');
      $('div#card-errors').hide();
      this.swalFire({
        icon: 'warning',
        text: '',
        title: ts('Please complete the reCaptcha')
      }, '.recaptcha-section', true);
      this.triggerEvent('crmBillingFormNotValid');
      this.form.dataset.submitted = 'false';
      return false;
    },

    /**
     * Validate if the discount code has been applied or the text-field is empty
     *
     * @returns {boolean}
     */
    validateCiviDiscount: function() {
      // cividiscount: when a code is applied it stays in the text-field
      // If it is valid discount-applied attribute is 1, otherwise it's undefined.
      // Logic: If we have a discountcode field, text in the discountcode field and the discount-applied attribute is not set do not submit form
      if ($('input#discountcode').length && ($('input#discountcode').val().length > 0) && ($('input#discountcode').attr('discount-applied') != 1)) {
        this.debugging(this.name,'Discount Code Entered but not applied');
        this.swalFire({
          icon: 'error',
          text: ts('Please apply the Discount Code or clear the Discount Code text-field'),
          title: ''
        }, '#crm-container', true);
        this.triggerEvent('crmBillingFormNotValid');
        this.form.dataset.submitted = 'false';
        return false;
      }
      return true;
    },

    /**
     * Check if form is valid (required fields filled in etc).
     * @returns {boolean}
     */
    validateForm: function() {
      if (($(this.form).valid() === false) || $(this.form).data('crmBillingFormValid') === false) {
        this.debugging(this.name, 'Form not valid');
        $('div#card-errors').hide();
        CRM.squarePayment.swalFire({
          icon: 'error',
          text: ts('Please check and fill in all required fields!'),
          title: ''
        }, '#crm-container', true);
        CRM.squarePayment.triggerEvent('crmBillingFormNotValid');
        CRM.squarePayment.form.dataset.submitted = 'false';
        return false;
      }
      return true;
    },

    /**
     * Find submit buttons which should not submit payment
     */
    addHandlerNonPaymentSubmitButtons: function() {
      // Find submit buttons which should not submit payment
      var nonPaymentSubmitButtons = this.form.querySelectorAll('[type="submit"][formnovalidate="1"], ' +
        '[type="submit"][formnovalidate="formnovalidate"], ' +
        '[type="submit"].cancel, ' +
        '[type="submit"].webform-previous'), i;
      for (i = 0; i < nonPaymentSubmitButtons.length; ++i) {
        nonPaymentSubmitButtons[i].addEventListener('click', submitDontProcess(nonPaymentSubmitButtons[i]));
      }

      function submitDontProcess(element) {
        CRM.squarePayment.debugging(CRM.squarePayment.scriptName, 'adding submitdontprocess: ' + element.id);
        CRM.squarePayment.form.dataset.submitdontprocess = 'true';
      }
    },

    /**
     * This adds handling for the CiviDiscount extension "apply" button.
     * A better way should really be found.
     */
    addSupportForCiviDiscount: function() {
      // Add a keypress handler to set flag if enter is pressed
      var cividiscountElements = this.form.querySelectorAll('input#discountcode');
      var cividiscountHandleKeydown = function(event) {
        if (event.code === 'Enter') {
          event.preventDefault();
          CRM.squarePayment.debugging(this.name, 'adding submitdontprocess');
          CRM.squarePayment.form.dataset.submitdontprocess = 'true';
        }
      };

      for (i = 0; i < cividiscountElements.length; ++i) {
        cividiscountElements[i].addEventListener('keydown', cividiscountHandleKeydown);
      }
    },

    /**
     * Display an error for the payment element
     *
     * @param {string} errorMessage - the error string
     * @param {boolean} notify - whether to popup a notification as well as
     *   display on the form.
     */
    displayError: function(errorMessage, notify) {
      // Display error.message in your UI.
      this.debugging(this.name, 'error: ' + errorMessage);
      // Inform the user if there was an error
      var errorElement = document.getElementById('card-errors');
      errorElement.style.display = 'block';
      errorElement.textContent = errorMessage;
      this.form.dataset.submitted = 'false';
      if (this.submitButtons !== null) {
        for (i = 0; i < this.submitButtons.length; ++i) {
          this.submitButtons[i].removeAttribute('disabled');
        }
      }
      this.triggerEvent('crmBillingFormNotValid');
      if (notify) {
        this.swalClose();
        CRM.squarePayment.swalFire({
          icon: 'error',
          text: errorMessage,
          title: ''
        }, '#card-element', true);
      }
    },

    /**
     * Wrapper around Swal.fire()
     * @param {array} parameters
     * @param {string} scrollToElement
     * @param {boolean} fallBackToAlert
     */
    swalFire: function(parameters, scrollToElement, fallBackToAlert) {
      if (typeof Swal === 'function') {
        if (scrollToElement.length > 0) {
          parameters.didClose = function() { window.scrollTo($(scrollToElement).position()); };
        }
        Swal.fire(parameters);
      }
      else if (fallBackToAlert) {
        window.alert(parameters.title + ' ' + parameters.text);
      }
    },

    /**
     * Wrapper around Swal.close()
     */
    swalClose: function() {
      if (typeof Swal === 'function') {
        Swal.close();
      }
    },

    /**
     * Trigger a jQuery event
     * @param {string} event
     */
    triggerEvent: function(event, scriptName) {
      var triggerNow = true;
      if (typeof scriptName !== 'undefined') {
        if (event === 'crmBillingFormReloadComplete') {
          this.scripts[scriptName].reloadComplete = true;
          $.each(CRM.squarePayment.scripts, function(scriptName,scriptObject) {
            if (scriptObject.reloadComplete !== true) {
              triggerNow = false;
              return;
            }
          });
        }
      }

      if (triggerNow) {
        this.debugging((typeof scriptName !== 'undefined') ? scriptName : this.name, 'Firing Event: ' + event);
        $(this.form).trigger(event);
      }
      else {
        this.debugging((typeof scriptName !== 'undefined') ? scriptName : this.name, 'Waiting for other scripts (' + event + ')');
      }
    },

    /**
     * This should be called as soon as a script is executed so CRM.squarePayment can handle multiple scripts on the DOM
     *
     * @param scriptName
     */
    registerScript: function(scriptName) {
      this.scripts[scriptName] = { reloadComplete: false };
    },

    /**
     * Output debug information
     * @param {string} scriptName
     * @param {string} errorCode
     */
    debugging: function(scriptName, errorCode) {
      if ((typeof(CRM.vars.payment) !== 'undefined') && (Boolean(CRM.vars.payment.jsDebug) === true)) {
        console.log(new Date().toISOString() + ' ' + scriptName + ': ' + errorCode);
      }
    }

  };

  if (typeof CRM.squarePayment === 'undefined') {
    CRM.squarePayment = payment;
  }
  else {
    if (CRM.squarePayment.hasOwnProperty('scriptName') && (CRM.squarePayment.scriptName === 'CRM.squarePayment')) {
      return;
    }
    if (CRM.squarePayment.hasOwnProperty('getTotalAmount')) {
      delete(payment.getTotalAmount);
      payment.debugging(payment.name, 'Deferring to client getTotalAmount function');
    }
    $.extend(CRM.squarePayment, payment);
  }

  document.addEventListener('DOMContentLoaded', function() {
    CRM.squarePayment.debugging('CRM.squarePayment', 'loaded via DOMContentLoaded');
    CRM.squarePayment.getBillingForm();
  });

  // Re-prep form when we've loaded a new payproc via ajax or via webform
  $(document).ajaxComplete(function(event, xhr, settings) {
    // /civicrm/payment/form? occurs when a payproc is selected on page
    // /civicrm/contact/view/participant occurs when payproc is first loaded on event credit card payment
    // On wordpress these are urlencoded
    if (CRM.squarePayment.isAJAXPaymentForm(settings.url)) {
      CRM.squarePayment.debugging('CRM.squarePayment', 'triggered via ajax');
      CRM.squarePayment.getBillingForm();
      // This resets the reload status of all scripts when CRM.squarePayment is reloaded
      $.each(CRM.squarePayment.scripts, function(scriptName,scriptObject) {
        CRM.squarePayment.scripts[scriptName].reloadComplete = false;
      });
    }
  });

}(CRM.$, CRM.ts('org.uschess.square')));
