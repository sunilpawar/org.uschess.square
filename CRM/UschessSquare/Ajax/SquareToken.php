<?php

use Civi\Api4\Contact;
use Civi\Api4\ContributionRecur;

class CRM_UschessSquare_Ajax_SquareToken {

  /**
   * Exchange a Web Payments SDK nonce for a CiviCRM-safe token.
   *
   * Request POST parameters:
   *  - token (string) Square nonce
   *  - processor_id (int)
   *  - contact_id (int)
   *
   * Response JSON:
   *  - {success: true, civi_token: "..."}  OR
   *  - {error: "message"}
   */
  public static function run() {
    try {
      $nonce = CRM_Utils_Type::validate($_POST['token'] ?? NULL, 'String');
      $processorId = CRM_Utils_Type::validate($_POST['processor_id'] ?? NULL, 'Integer');
      $contactId = CRM_Utils_Type::validate($_POST['contact_id'] ?? NULL, 'Integer');

      if (!$nonce || !$processorId || !$contactId) {
        return self::error("Missing required parameters.");
      }

      /** @var \CRM_Core_Payment_Square $processor */
      $processor = \CRM_Core_Payment::singleton($mode = 'live', $processorId);

      // Convert nonce → Square “card on file” or payment token.
      $customerId = $processor->ensureSquareCustomer(['contactID' => $contactId]);
      $cardId = $processor->createCardOnFile($customerId, $nonce);

      if (!$cardId) {
        return self::error("Unable to convert token.");
      }

      CRM_Utils_JSON::output([
        'success' => TRUE,
        'civi_token' => $cardId,
      ]);
    }
    catch (\Exception $e) {
      return self::error($e->getMessage());
    }
  }

  protected static function error($msg) {
    CRM_Utils_JSON::output([
      'success' => FALSE,
      'error' => $msg,
    ]);
  }
}