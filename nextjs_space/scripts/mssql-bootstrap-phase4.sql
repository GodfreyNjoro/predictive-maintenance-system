/*
 * PMS Phase 4 Bootstrap — Extended Events (XE) Session + ERRORLOG access
 *
 * Run AS A SYSADMIN on the target SQL Server instance.
 * This script:
 *   1. Creates the 'pms_collector' XE session capturing:
 *      - xml_deadlock_report  (deadlocks)
 *      - error_reported       (errors with severity >= 11)
 *      - attention             (query timeouts / client cancels)
 *      - login_failed          (authentication failures)
 *      - sql_batch_completed   (long-running queries > 5s)
 *      - rpc_completed         (long-running RPCs > 5s)
 *   2. Starts the session immediately.
 *   3. Verifies sp_readerrorlog is accessible to the collector login.
 *
 * Prerequisites:
 *   - The pms_collector login must already exist (Phase 1 bootstrap).
 *   - VIEW SERVER STATE must be granted (Phase 1 bootstrap).
 *
 * The session uses a ring_buffer target with a 16MB max memory cap.
 * Events are retained in memory only — no file target is created.
 *
 * Idempotent: safe to re-run.
 */

USE [master];
GO

-- 1. Drop existing session if it exists (idempotent)
IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'pms_collector')
BEGIN
    -- Stop first if running
    IF EXISTS (SELECT 1 FROM sys.dm_xe_sessions WHERE name = N'pms_collector')
    BEGIN
        ALTER EVENT SESSION [pms_collector] ON SERVER STATE = STOP;
    END
    DROP EVENT SESSION [pms_collector] ON SERVER;
    PRINT 'Dropped existing pms_collector XE session.';
END
GO

-- 2. Create the PMS collector XE session
CREATE EVENT SESSION [pms_collector] ON SERVER

  -- Deadlocks (critical)
  ADD EVENT sqlserver.xml_deadlock_report(
    ACTION (
      sqlserver.database_name,
      sqlserver.session_id,
      sqlserver.username,
      sqlserver.client_hostname
    )
  ),

  -- Errors with severity >= 11 (error / critical)
  ADD EVENT sqlserver.error_reported(
    ACTION (
      sqlserver.database_name,
      sqlserver.session_id,
      sqlserver.username,
      sqlserver.client_hostname,
      sqlserver.sql_text
    )
    WHERE severity >= 11
  ),

  -- Query timeouts / client cancels (error)
  ADD EVENT sqlserver.attention(
    ACTION (
      sqlserver.database_name,
      sqlserver.session_id,
      sqlserver.username,
      sqlserver.client_hostname,
      sqlserver.sql_text
    )
  ),

  -- Login failures (warning)
  ADD EVENT sqlserver.login_failed(
    ACTION (
      sqlserver.client_hostname
    )
  ),

  -- Long-running SQL batches > 5 seconds (5,000,000 microseconds)
  ADD EVENT sqlserver.sql_batch_completed(
    ACTION (
      sqlserver.database_name,
      sqlserver.session_id,
      sqlserver.username,
      sqlserver.client_hostname,
      sqlserver.sql_text
    )
    WHERE duration > 5000000
  ),

  -- Long-running RPCs > 5 seconds
  ADD EVENT sqlserver.rpc_completed(
    ACTION (
      sqlserver.database_name,
      sqlserver.session_id,
      sqlserver.username,
      sqlserver.client_hostname,
      sqlserver.sql_text
    )
    WHERE duration > 5000000
  )

  -- Ring buffer target: 16MB max, 4096 max events retained
  ADD TARGET package0.ring_buffer(
    SET max_memory = 16384,
        max_events_limit = 4096
  )

WITH (
  MAX_MEMORY = 8192 KB,
  EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS,
  MAX_DISPATCH_LATENCY = 5 SECONDS,
  STARTUP_STATE = ON      -- survives server restarts
);

PRINT 'Created pms_collector XE session.';
GO

-- 3. Start the session
ALTER EVENT SESSION [pms_collector] ON SERVER STATE = START;
PRINT 'Started pms_collector XE session.';
GO

-- 4. Verify: list active events in the session
SELECT
    s.name        AS session_name,
    se.name       AS event_name,
    st.target_name
FROM sys.dm_xe_sessions AS s
INNER JOIN sys.dm_xe_session_events AS se ON se.event_session_address = s.address
INNER JOIN sys.dm_xe_session_targets AS st ON st.event_session_address = s.address
WHERE s.name = N'pms_collector'
ORDER BY se.name;
GO

-- 5. Verify sp_readerrorlog access
-- If this returns rows, the collector login can read the ERRORLOG.
BEGIN TRY
    CREATE TABLE #el_test (LogDate datetime, ProcessInfo nvarchar(100), Text nvarchar(max));
    INSERT INTO #el_test EXEC sp_readerrorlog 0, 1;
    SELECT TOP 3 LogDate, ProcessInfo, LEFT(Text, 200) AS Text_Preview FROM #el_test ORDER BY LogDate DESC;
    DROP TABLE #el_test;
    PRINT 'sp_readerrorlog is accessible.';
END TRY
BEGIN CATCH
    PRINT 'WARNING: sp_readerrorlog is NOT accessible. The errorLog feed will not work.';
    PRINT 'Grant the collector login membership in the securityadmin role or sysadmin role.';
END CATCH
GO

PRINT '--- Phase 4 bootstrap complete ---';
GO
