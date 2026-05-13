-- =============================================================================
-- PMS bootstrap script — Phase 3 (waitStats / ioStats DMV snapshots)
-- =============================================================================
--
-- Phase 3 ships two new feeds that snapshot cumulative DMVs and emit deltas:
--
--   waitStats : sys.dm_os_wait_stats   → MSSQL.WaitStats
--   ioStats   : sys.dm_io_virtual_file_stats(NULL, NULL) → MSSQL.IoStats
--
-- Both feeds also read sys.dm_os_sys_info for `sqlserver_start_time` so the
-- mapper can detect server restarts (which reset the cumulative counters).
--
-- All three DMVs require **only `VIEW SERVER STATE`**, which the Phase 1
-- bootstrap (`scripts/mssql-bootstrap.sql`) already grants to the collector
-- login. THIS SCRIPT GRANTS NOTHING NEW — it is purely a diagnostic helper.
-- Run it as the collector login (NOT sysadmin) to confirm the permission set
-- is correct after Phase 1 + Phase 2 bootstraps.
--
-- Usage:
--   sqlcmd -S <server> -U <collector> -P <pwd> -d master -i mssql-bootstrap-phase3.sql
--
-- Output: a small results table per probe, plus a final summary row.
-- =============================================================================

SET NOCOUNT ON;

PRINT '== PMS Phase 3 sanity-check ==';
PRINT '== Login: ' + SUSER_SNAME();
PRINT '== Server: ' + @@SERVERNAME;
PRINT '== Date  : ' + CONVERT(varchar(40), SYSUTCDATETIME(), 126) + 'Z';
PRINT '';

-- -----------------------------------------------------------------------------
-- 1. Verify VIEW SERVER STATE
-- -----------------------------------------------------------------------------

DECLARE @hasViewServerState bit = 0;
BEGIN TRY
    -- This SELECT will fail with permission denied if VIEW SERVER STATE is missing.
    DECLARE @probe int;
    SELECT TOP 1 @probe = COUNT(*) FROM sys.dm_os_wait_stats;
    SET @hasViewServerState = 1;
    PRINT '[OK] VIEW SERVER STATE granted to ' + SUSER_SNAME() + '.';
END TRY
BEGIN CATCH
    PRINT '[FAIL] VIEW SERVER STATE is NOT granted to ' + SUSER_SNAME() + '.';
    PRINT '       Re-run scripts/mssql-bootstrap.sql as sysadmin to grant it.';
END CATCH

IF @hasViewServerState = 0
BEGIN
    PRINT '';
    PRINT '== Phase 3 will not work without VIEW SERVER STATE. Aborting probes.';
    RETURN;
END

-- -----------------------------------------------------------------------------
-- 2. Probe sys.dm_os_wait_stats — should return at least a few rows
-- -----------------------------------------------------------------------------

PRINT '';
PRINT '== Top 5 non-idle wait types (preview of waitStats feed) ==';
SELECT TOP 5
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    signal_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_time_ms > 0
  AND wait_type NOT IN (
    N'SLEEP_TASK', N'WAITFOR', N'LAZYWRITER_SLEEP', N'BROKER_TASK_STOP',
    N'CHECKPOINT_QUEUE', N'XE_TIMER_EVENT', N'BROKER_TO_FLUSH'
  )
ORDER BY wait_time_ms DESC;

-- -----------------------------------------------------------------------------
-- 3. Probe sys.dm_io_virtual_file_stats — should return a row per database file
-- -----------------------------------------------------------------------------

PRINT '';
PRINT '== Top 5 file-IO consumers (preview of ioStats feed) ==';
SELECT TOP 5
    DB_NAME(vfs.database_id) AS database_name,
    mf.name                  AS logical_name,
    vfs.num_of_reads,
    vfs.num_of_writes,
    vfs.io_stall_read_ms,
    vfs.io_stall_write_ms
FROM sys.dm_io_virtual_file_stats(NULL, NULL) AS vfs
INNER JOIN sys.master_files AS mf
    ON mf.database_id = vfs.database_id
   AND mf.file_id     = vfs.file_id
ORDER BY (vfs.io_stall_read_ms + vfs.io_stall_write_ms) DESC;

-- -----------------------------------------------------------------------------
-- 4. Probe sys.dm_os_sys_info — must expose sqlserver_start_time for restart detection
-- -----------------------------------------------------------------------------

PRINT '';
PRINT '== Server start time (used for restart detection) ==';
SELECT
    sqlserver_start_time,
    cpu_count,
    physical_memory_kb / 1024.0 / 1024.0 AS physical_memory_gb
FROM sys.dm_os_sys_info;

-- -----------------------------------------------------------------------------
-- 5. Summary
-- -----------------------------------------------------------------------------

PRINT '';
PRINT '== Phase 3 sanity-check completed successfully. ==';
PRINT '   * waitStats feed will become available after the first snapshot primes the cursor.';
PRINT '   * ioStats feed will become available after the first snapshot primes the cursor.';
PRINT '   * The first poll emits zero entries by design; the second poll emits deltas.';
PRINT '';
GO
