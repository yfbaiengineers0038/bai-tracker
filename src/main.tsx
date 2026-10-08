import { Amplify } from "aws-amplify";
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import outputs from "../amplify_outputs.json";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { authComponents } from "./AuthBranding";
import "./index.css";

Amplify.configure(outputs);

// `hideSignUp` drops the Create Account tab. Accounts are created by an
// administrator and scoped to a project, and the user pool refuses SignUp
// outright (allowAdminCreateUserOnly in amplify/backend.ts), so the tab could
// only ever fail. `signUpAttributes` goes with it — nothing signs up any more.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Authenticator hideSignUp components={authComponents}>
      <App />
    </Authenticator>
  </React.StrictMode>
);
