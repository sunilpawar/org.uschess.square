{if $squareInject}
  <div id="square-card-container"></div>
   {$form.square_payment_token.html}

  <script>
    window.squareApplicationId = "{$squareApplicationId|escape}";
    window.squareLocationId = "{$squareLocationId|escape}";
    window.squareProcessorId = "{$paymentProcessorID|escape}";
    window.squareContactId = "{$contact_id|escape}";
  </script>
{/if}