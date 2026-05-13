/*
  PMS — SQL Server collector account bootstrap (Phase 2)
  ======================================================

  Run this AFTER `scripts/mssql-bootstrap.sql`. Phase 2 adds:
    - Query Store read access on each user database you want to monitor.
    - The `dbo.PMS_SP_ExecutionLog` table for the INSTRUMENTED spExec feed,
      plus an example wrapper showing how to instrument an existing stored
      procedure so its outcomes flow into PMS.

  Replace `<your_user_db>` with the actual database name. Repeat the
  Query Store grants block once per database you intend to monitor.

  Tested on SQL Server 2016 SP1+. Query Store is available in every edition.
*/

--------------------------------------------------------------------------------
-- 1. Query Store — enable on the user database (no-op if already on)
--------------------------------------------------------------------------------
USE [<your_user_db>];
GO

IF EXISTS (
    SELECT 1
      FROM sys.database_query_store_options
     WHERE actual_state IN (0, 3)  -- 0 = OFF, 3 = ERROR
)
BEGIN
    ALTER DATABASE CURRENT
        SET QUERY_STORE = ON
          ( OPERATION_MODE = READ_WRITE,
            CLEANUP_POLICY = ( STALE_QUERY_THRESHOLD_DAYS = 30 ),
            DATA_FLUSH_INTERVAL_SECONDS = 900,
            INTERVAL_LENGTH_MINUTES = 15,
            MAX_STORAGE_SIZE_MB = 1024,
            QUERY_CAPTURE_MODE = AUTO,
            SIZE_BASED_CLEANUP_MODE = AUTO );
END;
GO

--------------------------------------------------------------------------------
-- 2. Query Store — grants for [pms_collector]
--------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'pms_collector')
BEGIN
    CREATE USER [pms_collector] FOR LOGIN [pms_collector];
END;
GO

GRANT SELECT ON sys.query_store_query         TO [pms_collector];
GRANT SELECT ON sys.query_store_plan          TO [pms_collector];
GRANT SELECT ON sys.query_store_runtime_stats TO [pms_collector];
GRANT SELECT ON sys.query_store_query_text    TO [pms_collector];
GRANT VIEW DATABASE STATE                     TO [pms_collector];  -- needed to read sys.database_query_store_options
GO

--------------------------------------------------------------------------------
-- 3. PMS_SP_ExecutionLog — INSTRUMENTED spExec contract
--------------------------------------------------------------------------------
-- PMS pulls rows from this table when DataSource.spLoggingMode = INSTRUMENTED.
-- Application-side stored procedures (or a thin wrapper SP) write one row per
-- execution. The collector reads strictly with the cursor `LogId`.
--
-- This table belongs to YOUR application database, not PMS. Adjust the schema
-- prefix if your app uses a non-`dbo` schema.

IF OBJECT_ID(N'dbo.PMS_SP_ExecutionLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.PMS_SP_ExecutionLog (
        LogId           BIGINT IDENTITY(1, 1) NOT NULL
            CONSTRAINT PK_PMS_SP_ExecutionLog PRIMARY KEY,
        StartedAt       DATETIME2(3)   NOT NULL
            CONSTRAINT DF_PMS_SP_ExecutionLog_StartedAt DEFAULT (SYSUTCDATETIME()),
        FinishedAt      DATETIME2(3)   NULL,
        DurationMs      INT            NULL,
        ProcedureName   SYSNAME        NULL,
        DatabaseName    SYSNAME        NULL
            CONSTRAINT DF_PMS_SP_ExecutionLog_DatabaseName DEFAULT (DB_NAME()),
        SchemaName      SYSNAME        NULL,
        RowsAffected    BIGINT         NULL,
        ErrorNumber     INT            NULL,
        ErrorMessage    NVARCHAR(MAX)  NULL,
        ParametersJson  NVARCHAR(MAX)  NULL,    -- optional; PMS does NOT persist this field by default (PII)
        ServerName      SYSNAME        NULL
            CONSTRAINT DF_PMS_SP_ExecutionLog_ServerName DEFAULT (CONVERT(SYSNAME, SERVERPROPERTY('ServerName'))),
        CONSTRAINT CK_PMS_SP_ExecutionLog_Duration CHECK (DurationMs IS NULL OR DurationMs >= 0)
    );

    -- The collector reads strictly by ascending LogId; primary key already
    -- provides the index it needs. No additional indexes required.
END;
GO

GRANT SELECT ON dbo.PMS_SP_ExecutionLog TO [pms_collector];
GO

--------------------------------------------------------------------------------
-- 4. Example wrapper — how to instrument an existing procedure
--------------------------------------------------------------------------------
-- Wrap your real procedure (`dbo.MyExistingProc`) with a thin caller that logs
-- start/finish + outcome. Adjust column names to taste; PMS only reads the
-- columns defined above. Keep the log inserts in their own TRY/CATCH so a
-- logging failure cannot break the underlying business logic.

/*
CREATE OR ALTER PROCEDURE dbo.MyExistingProc_Logged
    @SomeParam int = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @LogId       BIGINT;
    DECLARE @StartedAt   DATETIME2(3) = SYSUTCDATETIME();

    BEGIN TRY
        INSERT INTO dbo.PMS_SP_ExecutionLog
            (StartedAt, ProcedureName, SchemaName, ParametersJson)
        VALUES
            (@StartedAt,
             N'MyExistingProc_Logged',
             N'dbo',
             (SELECT @SomeParam AS SomeParam FOR JSON PATH, WITHOUT_ARRAY_WRAPPER));
        SET @LogId = SCOPE_IDENTITY();
    END TRY
    BEGIN CATCH
        -- Logging failure is non-fatal.
        SET @LogId = NULL;
    END CATCH;

    BEGIN TRY
        EXEC dbo.MyExistingProc @SomeParam = @SomeParam;
        DECLARE @Rows BIGINT = @@ROWCOUNT;

        IF @LogId IS NOT NULL
        BEGIN
            UPDATE dbo.PMS_SP_ExecutionLog
               SET FinishedAt   = SYSUTCDATETIME(),
                   DurationMs   = DATEDIFF(MILLISECOND, @StartedAt, SYSUTCDATETIME()),
                   RowsAffected = @Rows
             WHERE LogId = @LogId;
        END;
    END TRY
    BEGIN CATCH
        IF @LogId IS NOT NULL
        BEGIN
            UPDATE dbo.PMS_SP_ExecutionLog
               SET FinishedAt   = SYSUTCDATETIME(),
                   DurationMs   = DATEDIFF(MILLISECOND, @StartedAt, SYSUTCDATETIME()),
                   ErrorNumber  = ERROR_NUMBER(),
                   ErrorMessage = ERROR_MESSAGE()
             WHERE LogId = @LogId;
        END;
        THROW;  -- preserve original error for the caller
    END CATCH;
END;
GO
*/

--------------------------------------------------------------------------------
-- 5. Sanity check — verify Query Store and the SP log table
--------------------------------------------------------------------------------
-- EXECUTE AS LOGIN = N'pms_collector';
-- SELECT actual_state, actual_state_desc FROM sys.database_query_store_options;
-- SELECT TOP 5 query_id, plan_id, count_executions, avg_duration
--   FROM sys.query_store_runtime_stats
--   ORDER BY last_execution_time DESC;
-- SELECT COUNT(*) AS sp_log_rows FROM dbo.PMS_SP_ExecutionLog;
-- REVERT;
