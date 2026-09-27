import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { storage } from "./storage/resource";

const backend = defineBackend({
  auth,
  data,
  storage,
});

const { cfnUserPool, cfnIdentityPool } = backend.auth.resources.cfnResources;

// Self-service registration off. Cognito's SignUp API starts refusing
// everyone, which is the only way to actually close registration: the user pool
// and app client IDs ship inside the iOS bundle and the web bundle, so a check
// in either UI is cosmetic. Users are created with `admin-create-user` (or the
// console's Create user button) and choose their own password on first sign-in.
cfnUserPool.adminCreateUserConfig = {
  allowAdminCreateUserOnly: true,
};

// Guest credentials off — neither app uses unauthenticated identities, and
// leaving them enabled hands IAM credentials to anyone who asks.
cfnIdentityPool.allowUnauthenticatedIdentities = false;
