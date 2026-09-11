import type { User } from './table-types'

const tableData: User[] = [
  {
    firstName: 'Tanner',
    lastName: 'Linsley',
    age: 33,
    visitedAt: new Date('12-05-2005'),
    progress: 50,
    status: 'MARRIED',
  },
  {
    firstName: 'Kevin',
    lastName: 'Vandy',
    age: 27,
    visitedAt: new Date('12-02-2025'),
    progress: 100,
    status: 'SINGLE',
  },
]

export default tableData
