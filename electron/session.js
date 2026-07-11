let currentUser = null; // { id, name, role }

function setCurrentUser(user) {
  currentUser = user ? { id: user.id, name: user.name, role: user.role } : null;
}

function getCurrentUser() {
  return currentUser;
}

module.exports = { setCurrentUser, getCurrentUser };
