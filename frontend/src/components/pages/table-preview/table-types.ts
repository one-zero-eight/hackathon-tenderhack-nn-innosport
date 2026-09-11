export type User = {
  firstName: string
  lastName: string
  age: number
  visitedAt: Date
  progress: number
  status: UserStatus
}

export type UserStatus = 'MARRIED' | 'SINGLE'
