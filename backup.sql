DROP PROCEDURE IF EXISTS sp_auth_register_user;
DELIMITER $$
CREATE PROCEDURE `sp_auth_register_user`(
  IN p_email VARCHAR(255),
  IN p_password VARCHAR(255),
  IN p_org_name VARCHAR(255)
)
BEGIN
  DECLARE v_user_id CHAR(36);
  DECLARE v_org_id CHAR(36);

  -- check duplicate user
  IF EXISTS (SELECT 1 FROM users WHERE email = p_email) THEN
    SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'USER_ALREADY_EXISTS';
  END IF;

  SET v_user_id = UUID();

  START TRANSACTION;

  INSERT INTO users (id, email, password )
  VALUES (v_user_id, p_email, p_password);

  COMMIT;

  SELECT v_user_id AS userId, v_org_id AS orgId;
END $$
DELIMITER ;