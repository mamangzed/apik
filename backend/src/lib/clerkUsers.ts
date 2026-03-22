import axios from 'axios';

type ClerkEmail = {
  email_address?: string;
};

type ClerkUser = {
  id: string;
  username?: string | null;
  email_addresses?: ClerkEmail[];
};

function getClerkSecretKey(): string {
  const key = process.env.CLERK_SECRET_KEY;
  if (!key) {
    throw new Error('CLERK_SECRET_KEY is not configured');
  }
  return key;
}

function getClerkApiBaseUrl(): string {
  return process.env.CLERK_API_URL || 'https://api.clerk.com';
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function getUserById(userId: string): Promise<ClerkUser | null> {
  try {
    const response = await axios.get<ClerkUser>(`${getClerkApiBaseUrl()}/v1/users/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Bearer ${getClerkSecretKey()}`,
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

async function searchUsers(query: string): Promise<ClerkUser[]> {
  const response = await axios.get<ClerkUser[]>(`${getClerkApiBaseUrl()}/v1/users`, {
    headers: {
      Authorization: `Bearer ${getClerkSecretKey()}`,
    },
    params: {
      query,
      limit: 50,
    },
    timeout: 10000,
  });

  return response.data || [];
}

export async function resolveClerkUserId(identifier: string): Promise<string | null> {
  const raw = identifier.trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith('user_')) {
    const user = await getUserById(raw);
    return user?.id || null;
  }

  const users = await searchUsers(raw);
  if (users.length === 0) {
    return null;
  }

  const normalized = normalize(raw);
  const byUsername = users.find((user) => user.username && normalize(user.username) === normalized);
  if (byUsername) {
    return byUsername.id;
  }

  const byEmail = users.find((user) =>
    (user.email_addresses || []).some((entry) => normalize(entry.email_address || '') === normalized),
  );
  if (byEmail) {
    return byEmail.id;
  }

  // For exact user id-like queries that do not use user_ prefix.
  const byId = users.find((user) => normalize(user.id) === normalized);
  if (byId) {
    return byId.id;
  }

  if (isLikelyEmail(raw)) {
    return null;
  }

  return null;
}
