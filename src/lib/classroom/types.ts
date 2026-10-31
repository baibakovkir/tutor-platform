export type Student = {
  id: number;
  name: string;
  phone: string;
  subject: string;
  rate: number;
  meetingUrl: string;
  notes: string;
  invited: boolean;
};
export type Lesson = {
  id: number;
  studentId: number;
  studentName: string;
  date: string;
  start: string;
  end: string;
  attended: boolean;
  price: string;
  payment: "paid" | "unpaid";
  title: string;
  meetingUrl: string;
  cancelled: boolean;
};
export type Homework = {
  id: number;
  student_id: number;
  session_id: number | null;
  title: string;
  body: string;
  due_date: string;
  exercise_id: number | null;
  status: "assigned" | "submitted" | "reviewed";
  submission: string;
  feedback: string;
  studentName: string;
  exerciseTitle: string | null;
  kind: "choice" | "short" | "text" | null;
  prompt: string | null;
  options: string[] | null;
};
export type Exercise = {
  id: number;
  title: string;
  kind: "choice" | "short" | "text";
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  owner_id: number | null;
};
export type Attachment = {
  id: string;
  homework_id: number;
  name: string;
  size: number;
  student_upload: boolean;
};
export type Attempt = {
  id: number;
  homework_id: number;
  response: string;
  correct: boolean | null;
  created_at: string;
};
export type Snapshot = {
  role: "teacher" | "student";
  name: string;
  students: Student[];
  lessons: Lesson[];
  homework: Homework[];
  exercises: Exercise[];
  files: Attachment[];
  attempts: Attempt[];
};
