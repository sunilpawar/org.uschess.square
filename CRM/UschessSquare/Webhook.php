<?php

class CRM_UschessSquare_Webhook {

  protected $processor;

  public function __construct($processor) {
    $this->processor = $processor;
  }

  /**
   * Handle incoming webhook requests from Square.
   */
  public function handle() {
    $raw = file_get_contents('php://input');
    $headers = getallheaders();
    $url = $this->getNotificationUrl();

    if (!$this->isValidSquareSignature($raw, $headers, $url)) {
      CRM_Core_Error::debug_log_message("Square Webhook: Invalid signature");
      header("HTTP/1.1 401 Unauthorized");
      echo "Invalid signature";
      return;
    }

    $payload = json_decode($raw, TRUE);
    if (!$payload) {
      CRM_Core_Error::debug_log_message("Square Webhook: Invalid JSON body");
      header("HTTP/1.1 400 Bad Request");
      echo "Invalid JSON";
      return;
    }

    $eventId = $payload['event_id'] ?? NULL;
    if ($eventId && $this->isDuplicateEvent($eventId)) {
      CRM_Core_Error::debug_log_message("Square Webhook: Duplicate event $eventId skipped");
      header("HTTP/1.1 200 OK");
      echo "OK";
      return;
    }
    if ($eventId) {
      $this->markEventProcessed($eventId);
    }

    $eventType = $payload['type'] ?? '';
    CRM_Core_Error::debug_log_message("Square Webhook: Received event $eventType");

    switch ($eventType) {

      case 'payment.created':
      case 'payment.updated':
        $payment = $payload['data']['object']['payment'] ?? [];
        $this->processor->syncPaymentFromSquare($payment);
        break;

      case 'payment.refunded':
        $refund = $payload['data']['object']['refund'] ?? [];
        $this->processor->syncRefundFromSquare($refund);
        break;

      case 'subscription.created':
      case 'subscription.updated': {
        $subscription = $payload['data']['object']['subscription'] ?? [];
        $subscriptionId = $subscription['id'] ?? NULL;
        if ($subscriptionId) {
          $this->processor->syncSubscriptionFromSquare($subscriptionId);
        }
        break;
      }

      case 'subscription.canceled':
      case 'subscription.deleted': {
        $subscription = $payload['data']['object']['subscription'] ?? [];
        $subscriptionId = $subscription['id'] ?? NULL;
        if ($subscriptionId) {
          $this->processor->syncSubscriptionCancellationFromSquare($subscriptionId);
        }
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_failed':
        $invoice = $payload['data']['object']['invoice'] ?? [];
        $this->processor->syncInvoiceFromSquare($invoice);
        break;

      default:
        CRM_Core_Error::debug_log_message("Square Webhook: Unhandled event type $eventType");
        break;
    }

    header("HTTP/1.1 200 OK");
    echo "OK";
  }

  /**
   * Validate Square webhook signature (Square 2024–2025 standard).
   */
  protected function isValidSquareSignature($raw, $headers, $url) {
    // Normalize header keys to lowercase
    $normalized = [];
    foreach ($headers as $k => $v) {
      $normalized[strtolower($k)] = $v;
    }

    $key = $this->processor->getWebhookSignatureKey();
    if (!$key) {
      CRM_Core_Error::debug_log_message("Square Webhook: Missing webhook signature key");
      return FALSE;
    }

    // Square sends "X-Square-Signature"
    $provided = $normalized['x-square-signature'] ?? NULL;
    if (!$provided) {
      CRM_Core_Error::debug_log_message(
        "Square Webhook: Signature header missing. Available headers: " . json_encode(array_keys($normalized))
      );
      return FALSE;
    }

    // Square Webhook Signature Algorithm (2024–2025):
    // expected = base64encode( HMAC-SHA256( notification_url + request_body, signature_key ) )
    $message = $url . $raw;

    $expected = base64_encode(
      hash_hmac('sha256', $message, $key, TRUE)
    );

    // Prevent timing attacks
    $valid = hash_equals($expected, $provided);

    if (!$valid) {
      CRM_Core_Error::debug_log_message(
        "Square Webhook: Signature mismatch. expected=$expected provided=$provided url=$url"
      );
    }

    return $valid;
  }

  /**
   * Build the callback URL used by Square signature verification.
   */
  protected function getNotificationUrl() {
    $base = CRM_Utils_System::url('civicrm/square/webhook', NULL, TRUE, NULL, TRUE);
    return $base;
  }

  /**
   * Prevent replay attacks by logging processed event IDs.
   */
  protected function isDuplicateEvent($eventId) {
    $cache = CRM_Utils_Cache::create([
      'name' => 'square_webhook_cache',
      'type' => 'ArrayCache',
      'prefetch' => FALSE,
    ]);

    return (bool) $cache->get($eventId);
  }

  protected function markEventProcessed($eventId) {
    $cache = CRM_Utils_Cache::create([
      'name' => 'square_webhook_cache',
      'type' => 'ArrayCache',
      'prefetch' => FALSE,
    ]);

    $cache->set($eventId, TRUE, 3600);
  }
}