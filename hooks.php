<?php

use CRM_Core_Form;
use CRM_Utils_System;
use CRM_Core_Error;
use CRM_UschessSquare_Webhook;
use CRM_Core_Payment_Square;
use Exception;

/**
 * Implementation of hook_civicrm_pageRun().
 *
 * This creates a public-facing URL:
 *   /civicrm/square/webhook
 *
 * Square will POST webhook events to that URL.
 */
function org_uschess_square_civicrm_pageRun(&$page) {
  $path = trim(CRM_Utils_System::currentPath(), '/');

  if ($path === 'civicrm/square/webhook') {

    // Load the Square payment processor instance.
    try {
      $pp = civicrm_api3('PaymentProcessor', 'getsingle', [
        'payment_processor_type_id:name' => 'Square',
      ]);
    }
    catch (Exception $e) {
      CRM_Core_Error::debug_log_message("Square Webhook: cannot load payment processor: " . $e->getMessage());
      CRM_Utils_System::civiExit();
    }

    // Instantiate your processor class.
    $processor = new CRM_Core_Payment_Square('live', $pp);

    // Explicit event router for Square webhook events.
    $payload = file_get_contents('php://input');
    $event = json_decode($payload, TRUE);

    if (!is_array($event) || empty($event['type'])) {
      CRM_Core_Error::debug_log_message("Square Webhook: Invalid payload");
      CRM_Utils_System::civiExit();
    }

    $handler = new CRM_UschessSquare_Webhook($processor);

    switch ($event['type']) {
      case 'subscription.canceled':
        $handler->handleSubscriptionCanceled($event);
        break;

      case 'invoice.paid':
        $handler->handleInvoicePaid($event);
        break;

      case 'subscription.updated':
        $handler->handleSubscriptionUpdated($event);
        break;

      default:
        // fallback for unhandled events
        $handler->handle($event);
        break;
    }

    CRM_Utils_System::civiExit();
  }
}

/**
 * Implementation of hook_civicrm_config().
 * Required to autoload CRM/UschessSquare classes.
 */
function org_uschess_square_civicrm_config(&$config) {
  _org_uschess_square_civix_civicrm_config($config);
}

/**
 * Implementation of hook_civicrm_xmlMenu().
 */
function org_uschess_square_civicrm_xmlMenu(&$files) {
  _org_uschess_square_civix_civicrm_xmlMenu($files);
}

/**
 * Implementation of hook_civicrm_install().
 */
function org_uschess_square_civicrm_install() {
  _org_uschess_square_civix_civicrm_install();
}

/**
 * Implementation of hook_civicrm_uninstall().
 */
function org_uschess_square_civicrm_uninstall() {
  _org_uschess_square_civix_civicrm_uninstall();
}

/**
 * Implementation of hook_civicrm_enable().
 */
function org_uschess_square_civicrm_enable() {
  _org_uschess_square_civix_civicrm_enable();
}

/**
 * Implementation of hook_civicrm_disable().
 */
function org_uschess_square_civicrm_disable() {
  _org_uschess_square_civix_civicrm_disable();
}

/**
 * Implementation of hook_civicrm_upgrade().
 */
function org_uschess_square_civicrm_upgrade($op, CRM_Queue_Queue $queue = NULL) {
  return _org_uschess_square_civix_civicrm_upgrade($op, $queue);
}

/**
 * Implementation of hook_civicrm_managed().
 */
function org_uschess_square_civicrm_managed(&$entities) {
  _org_uschess_square_civix_civicrm_managed($entities);
}

/**
 * Inject Square Web Payments SDK + JS + card container into contribution forms.
 *
 * @param string $formName
 * @param CRM_Core_Form $form
 */
function org_uschess_square_civicrm_buildForm($formName, &$form) {
  // Only act on contribution and event registration forms.
  if (!in_array($formName, ['CRM_Contribute_Form_Contribution', 'CRM_Event_Form_Registration'], TRUE)) {
    return;
  }

  // Get payment processor currently in use.
  $processor = $form->getVar('_paymentProcessor');
  if (empty($processor)) {
    return;
  }

  // Only if this is the Square processor.
  $className = $processor['class_name'] ?? '';
  if ($className !== 'Payment_Square' && $className !== 'CRM_Core_Payment_Square') {
    return;
  }

  // Hidden field where the JS will store the card token.
  if (!$form->elementExists('square_payment_token')) {
    $form->add('hidden', 'square_payment_token', '', ['id' => 'square-payment-token']);
  }

  // Inject the container where Square will mount the card fields + error box.
  $markup = '
    <div id="square-card-container"></div>
    <div id="square-card-errors" class="messages error" style="display:none"></div>
  ';

  // Attach this to the billing block region so it appears in the right place.
  CRM_Core_Region::instance('billing-block')->add([
    'markup' => $markup,
  ]);

  // Decide sandbox vs live SDK URL.
  $isSandbox = !empty($processor['is_test']);
  $sdkUrl = $isSandbox
    ? 'https://sandbox.web.squarecdn.com/v1/square.js'
    : 'https://web.squarecdn.com/v1/square.js';

  $resources = CRM_Core_Resources::singleton();

  // Load Square’s JS SDK.
  $resources->addScriptUrl($sdkUrl, 0, 'html-header');

  // Load our own integration JS from the extension.
  $resources->addScriptFile('org.uschess.square', 'js/square.js', 10, 'html-header');

  // Pass settings to JS.
  $settings = [
    'applicationId' => $processor['user_name'] ?? '',
    // Prefer signature as Location ID (per config labels), then password as fallback.
    'locationId'    => $processor['signature'] ?? ($processor['password'] ?? ''),
    'isSandbox'     => $isSandbox,
    // Generic custom AJAX endpoint in Civi that will call our static handler.
    'ajaxUrl'       => CRM_Utils_System::url(
      'civicrm/ajax/custom',
      NULL,
      TRUE,  // absolute
      NULL,
      FALSE,
      TRUE   // frontend
    ),
  ];

  $resources->addSetting([
    'orgUschessSquare' => $settings,
  ]);
}

/**
 * Implementation of hook_civicrm_post().
 *
 * Basic support for detecting edits to recurring contributions that
 * are processed by the Square payment processor. For now this only logs
 * the change and provides a clear extension point for future logic
 * that will sync edits to the corresponding Square subscription.
 */
function org_uschess_square_civicrm_post($op, $objectName, $objectId, &$objectRef) {
  // We only care about edits to recurring contribution records.
  if ($objectName !== 'ContributionRecur' || $op !== 'edit') {
    return;
  }

  // Ensure API4 is available.
  if (!class_exists('\\Civi\\Api4\\ContributionRecur')) {
    CRM_Core_Error::debug_log_message('Square: API4 ContributionRecur class not available in civicrm_post.');
    return;
  }

  try {
    // Load the updated recurring contribution record.
    $recur = \Civi\Api4\ContributionRecur::get(FALSE)
      ->addSelect('id', 'payment_processor_id', 'amount', 'status_id', 'frequency_interval', 'frequency_unit')
      ->addWhere('id', '=', (int) $objectId)
      ->execute()
      ->first();

    if (empty($recur) || empty($recur['payment_processor_id'])) {
      return;
    }

    // Load the payment processor to see if it is a Square processor.
    $processor = \Civi\Api4\PaymentProcessor::get(FALSE)
      ->addSelect('id', 'name', 'class_name', 'payment_processor_type_id:label')
      ->addWhere('id', '=', (int) $recur['payment_processor_id'])
      ->execute()
      ->first();

    if (empty($processor)) {
      return;
    }

    // We treat this as a Square-backed recurring contribution either if the
    // class_name is Payment_Square or the type label contains 'Square'.
    $isSquare = (
      (!empty($processor['class_name']) && $processor['class_name'] === 'Payment_Square') ||
      (!empty($processor['payment_processor_type_id:label']) && stripos($processor['payment_processor_type_id:label'], 'square') !== FALSE)
    );

    if (!$isSquare) {
      return;
    }

    // At this point we know a Square-backed recurring contribution was edited.
    // For now we simply log the change. Later this is where we can call into
    // CRM_Core_Payment_Square to adjust the corresponding Square subscription.
    CRM_Core_Error::debug_log_message(sprintf(
      'Square: ContributionRecur #%d edited (amount=%s, status_id=%s, freq=%s %s).',
      $recur['id'],
      $recur['amount'] ?? 'n/a',
      $recur['status_id'] ?? 'n/a',
      $recur['frequency_interval'] ?? 'n/a',
      $recur['frequency_unit'] ?? 'n/a'
    ));
  }
  catch (Exception $e) {
    CRM_Core_Error::debug_log_message('Square: Error in civicrm_post ContributionRecur handler: ' . $e->getMessage());
  }
}

