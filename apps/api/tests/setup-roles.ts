import { setRoleLookup } from "../src/auth.js";

// requireAdmin also asks the database whether the caller is an admin. The route tests have no database and speak as
// members whose role there is the one their x-user-role header says, so every id they send is an admin here and the
// header decides, as in production for a real admin. tests/auth.test.ts tests the database's word itself.
setRoleLookup(async () => "ADMIN");
