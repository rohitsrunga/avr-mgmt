import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js'
import { CONFIG } from '../config'

const AuthContext = createContext(null)

const userPool = CONFIG.userPoolId && CONFIG.userPoolClientId
  ? new CognitoUserPool({
      UserPoolId: CONFIG.userPoolId,
      ClientId: CONFIG.userPoolClientId,
    })
  : null

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return {}
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [tokens, setTokens] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pendingChallenge, setPendingChallenge] = useState(null)

  useEffect(() => {
    if (!userPool) {
      setLoading(false)
      return
    }
    const cognitoUser = userPool.getCurrentUser()
    if (!cognitoUser) {
      setLoading(false)
      return
    }
    cognitoUser.getSession((err, session) => {
      if (err || !session?.isValid()) {
        setLoading(false)
        return
      }
      const idToken = session.getIdToken().getJwtToken()
      const accessToken = session.getAccessToken().getJwtToken()
      setTokens({ idToken, accessToken })
      setUser(buildUserFromToken(idToken))
      setLoading(false)
    })
  }, [])

  function buildUserFromToken(idToken) {
    const c = decodeJwt(idToken)
    return {
      sub: c.sub,
      email: c.email,
      name: c.name || c.email,
      role: c['custom:role'] || '',
      property: c['custom:property'] || '',
    }
  }

  function login(email, password) {
    return new Promise((resolve, reject) => {
      if (!userPool) return reject(new Error('Auth not configured. Run sam deploy and set frontend env vars.'))
      const cognitoUser = new CognitoUser({ Username: email, Pool: userPool })
      const authDetails = new AuthenticationDetails({ Username: email, Password: password })
      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          const idToken = session.getIdToken().getJwtToken()
          const accessToken = session.getAccessToken().getJwtToken()
          setTokens({ idToken, accessToken })
          setUser(buildUserFromToken(idToken))
          setPendingChallenge(null)
          resolve({ challenge: null })
        },
        onFailure: (err) => reject(err),
        newPasswordRequired: () => {
          setPendingChallenge({ type: 'NEW_PASSWORD_REQUIRED', cognitoUser })
          resolve({ challenge: 'NEW_PASSWORD_REQUIRED' })
        },
      })
    })
  }

  function completeNewPassword(newPassword) {
    return new Promise((resolve, reject) => {
      if (!pendingChallenge) return reject(new Error('No pending challenge'))
      pendingChallenge.cognitoUser.completeNewPasswordChallenge(newPassword, {}, {
        onSuccess: (session) => {
          const idToken = session.getIdToken().getJwtToken()
          const accessToken = session.getAccessToken().getJwtToken()
          setTokens({ idToken, accessToken })
          setUser(buildUserFromToken(idToken))
          setPendingChallenge(null)
          resolve()
        },
        onFailure: (err) => reject(err),
      })
    })
  }

  function logout() {
    if (userPool) {
      const cognitoUser = userPool.getCurrentUser()
      if (cognitoUser) cognitoUser.signOut()
    }
    setUser(null)
    setTokens(null)
  }

  async function refreshIdToken() {
    if (!userPool) return null
    const cognitoUser = userPool.getCurrentUser()
    if (!cognitoUser) return null
    return new Promise((resolve) => {
      cognitoUser.getSession((err, session) => {
        if (err || !session?.isValid()) return resolve(null)
        const idToken = session.getIdToken().getJwtToken()
        const accessToken = session.getAccessToken().getJwtToken()
        setTokens({ idToken, accessToken })
        resolve(idToken)
      })
    })
  }

  const value = useMemo(() => ({
    user, tokens, loading, login, logout, completeNewPassword, pendingChallenge, refreshIdToken,
  }), [user, tokens, loading, pendingChallenge])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  return useContext(AuthContext)
}
