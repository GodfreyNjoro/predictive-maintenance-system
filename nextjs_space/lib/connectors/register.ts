/**
 * Connector auto-registration shim.
 *
 * Importing this module from the scheduler / API layer is enough to
 * populate the connector registry with every adapter we ship. Each adapter
 * registers itself at module-load by calling `registerConnector()`.
 *
 * Add a new DBMS by adding a single import line below.
 */

import "./mssql";
import "./postgres";
import "./mysql";
// import "./oracle";     // Phase 5

export {}; // ensure this is treated as a module
