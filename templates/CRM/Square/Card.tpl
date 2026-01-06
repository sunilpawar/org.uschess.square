{if $squareInject}
  <div id="square-card-container"></div>
  <input type="hidden" name="square_payment_token" id="square_payment_token" />

  <script>
    window.squareApplicationId = "{$squareApplicationId|escape}";
    window.squareLocationId = "{$squareLocationId|escape}";
    window.squareProcessorId = "{$paymentProcessorID|escape}";
    window.squareContactId = "{$contact_id|escape}";
  </script>
{/if}