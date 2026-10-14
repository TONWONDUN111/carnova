import {
  AuthError,
  acceptInvite,
  MissingIdentityError,
  getUser,
  handleAuthCallback,
  login,
  logout,
  requestPasswordRecovery,
  signup,
  updateUser,
} from "@netlify/identity";

export const initializeAuth = async () => {
  const callback = await handleAuthCallback();
  return { callback, user: callback?.user ?? (await getUser()) };
};

export const signIn = (email, password) => login(email, password);
export const signUp = (email, password, name) =>
  signup(email, password, { full_name: name });
export const signOut = () => logout();
export const recoverPassword = (email) => requestPasswordRecovery(email);
// Recovery links sign the user in; invite links carry a token instead. Either
// way the user must choose a password before continuing.
export const setNewPassword = (password, callback) =>
  callback?.type === "invite"
    ? acceptInvite(callback.token, password)
    : updateUser({ password });
export { AuthError, MissingIdentityError };
