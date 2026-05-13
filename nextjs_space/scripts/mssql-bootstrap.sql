/*
  PMS — SQL Server collector account bootstrap
  ============================================

  Run this on the SQL Server instance you want PMS to monitor.

  Phase 1 ingestion (job-history) requires:
    - VIEW SERVER STATE   (probe queries)
    - VIEW ANY DATABASE   (probe queries; harmless when only msdb is read)
    - SELECT on msdb.dbo.sysjobs / sysjobhistory / sysjobsteps / sysjobactivity

  Replace the password below with a strong, randomly generated value.
  The same secret is then entered into the PMS UI; PMS encrypts it at rest
  with AES-256-GCM (PMS_DSN_KEY) before persisting.

  Tested on SQL Server 2016+ (12.x and newer). Works for both Windows-domain
  and SQL-authenticated instances. If you use Windows Auth, skip the LOGIN
  step and grant the rights to your existing AD account instead.
*/

--------------------------------------------------------------------------------
-- 1. Create a dedicated SQL login (skip if using Windows / domain auth).
--------------------------------------------------------------------------------
USE [master];
GO

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'pms_collector')
BEGIN
    CREATE LOGIN [pms_collector]
        WITH PASSWORD     = N'<<REPLACE-WITH-STRONG-PASSWORD>>',
             CHECK_POLICY = ON;
END;
GO

--------------------------------------------------------------------------------
-- 2. Server-level rights for connection probes.
--------------------------------------------------------------------------------
GRANT VIEW SERVER STATE  TO [pms_collector];
GRANT VIEW ANY DATABASE  TO [pms_collector];
GO

--------------------------------------------------------------------------------
-- 3. msdb access — the home of SQL Agent metadata (Phase 1 jobHistory feed).
--------------------------------------------------------------------------------
USE [msdb];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'pms_collector')
BEGIN
    CREATE USER [pms_collector] FOR LOGIN [pms_collector];
END;
GO

GRANT SELECT ON OBJECT::dbo.sysjobs        TO [pms_collector];
GRANT SELECT ON OBJECT::dbo.sysjobhistory  TO [pms_collector];
GRANT SELECT ON OBJECT::dbo.sysjobsteps    TO [pms_collector];
GRANT SELECT ON OBJECT::dbo.sysjobactivity TO [pms_collector];
GO

/*
  Phase 2+ grants (uncomment when you light up these feeds):

  -- Query Store (per user database)
  USE [<your_user_db>];
  CREATE USER [pms_collector] FOR LOGIN [pms_collector];
  GRANT SELECT ON sys.query_store_plan          TO [pms_collector];
  GRANT SELECT ON sys.query_store_query         TO [pms_collector];
  GRANT SELECT ON sys.query_store_query_text    TO [pms_collector];
  GRANT SELECT ON sys.query_store_runtime_stats TO [pms_collector];
  GO

  -- Extended Events (server-level)
  USE [master];
  GRANT ALTER ANY EVENT SESSION TO [pms_collector];
  GO
*/

--------------------------------------------------------------------------------
-- 4. Sanity check — should return at least one row if pms_collector can read
--    SQL Agent history. Run AS [pms_collector] (EXECUTE AS LOGIN) to verify.
--------------------------------------------------------------------------------
-- EXECUTE AS LOGIN = N'pms_collector';
-- SELECT TOP 5 j.name, h.run_date, h.run_time, h.run_status
--   FROM msdb.dbo.sysjobhistory h
--   JOIN msdb.dbo.sysjobs       j ON j.job_id = h.job_id
--  ORDER BY h.run_date DESC, h.run_time DESC;
-- REVERT;
