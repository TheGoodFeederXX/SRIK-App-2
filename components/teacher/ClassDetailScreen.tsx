import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { listStudents } from '../../src/lib/supabase/students';

import { Student, ClassInfo } from '../../types';
import { ChevronRightIcon, TeacherAttendanceIcon, ClipboardListIcon } from '../../constants';
import { getFormattedClassName } from '../../constants';
import { useRealtimeRefresh } from '../../hooks/useRealtimeRefresh';
import { useProfile } from '../../context/ProfileContext';

interface ClassDetailScreenProps {
  classInfo: ClassInfo;
  navigateTo: (view: string, title: string, props: any) => void;
}

const ClassDetailScreen: React.FC<ClassDetailScreenProps> = ({ classInfo, navigateTo }) => {
    const { t } = useTranslation();
  const { profile } = useProfile();
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

    const fetchStudents = async () => {
        if (!classInfo) return;
        setLoading(true);
        try {
            // The children in THIS class, from the database.
            //
            // This called `api.getStudentsByClassId`, whose own comment explained it
            // existed so "the backend uses the JWT school_id" — and there is no
            // backend. Every class tile opened an empty list, on the screen a teacher
            // uses to reach the register.
            //
            // `listStudents` returns the school's roll with each child's current
            // class already resolved from the enrollment, and pages the read. The
            // filter is by `classId`, NOT by class name: the school renames classes
            // ("5 Na'im" today, something else tomorrow) and matching text would break
            // silently on the next rename, which is why the loader returns an id.
            const all = await listStudents();
            const rows = all.filter(r => r.classId === classInfo.id);

            setStudents(rows.map((r): Student => ({
                id: r.id,
                // The admission number IS the school's own identifier for a child.
                schoolId: r.admissionNo,
                name: r.fullName || 'Unnamed',
                // A child's class comes from the enrollment, so the year level is the
                // database's own number rather than something parsed back out of a
                // class name the school can rename at any time.
                grade: String(r.yearLevel ?? classInfo.grade ?? ''),
                section: classInfo.section ?? '',
                avatarUrl: r.className,
                // No attendance has been read here, so nothing is claimed about it.
                // The old code defaulted to 'Absent', which would have shown a whole
                // class as absent to any screen that trusted the field.
                attendanceStatus: 'Present',
            } as unknown as Student)));
        } catch (err) {
            console.error('Error fetching students for class:', err);
        } finally {
            setLoading(false);
        }
    };

  useEffect(() => {
    fetchStudents();
  }, [classInfo]);

  // Auto-refresh when students table changes in real-time
  useRealtimeRefresh(['students'], fetchStudents);

  if (!classInfo) return <div className="flex items-center justify-center min-h-[40vh] p-8 text-center text-gray-500">{t('classDetailScreen.selectAClassToViewItsDetails')}</div>;

  const formattedClassName = classInfo.name || getFormattedClassName(classInfo.grade, classInfo.section);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header Info */}
      <div className="p-4 bg-white border-b border-gray-200">
        <h3 className="font-bold text-lg text-gray-800">Students in {formattedClassName}</h3>
        <p className="text-sm text-gray-500">{students.length} total students</p>
      </div>

      {/* Action Buttons */}
      <div className="p-4 grid grid-cols-2 gap-3 bg-white border-b border-gray-200">
        <button onClick={() => navigateTo('markAttendance', `${t('classDetailScreen.attendance')}: ${formattedClassName}`, { classInfo })} className="flex items-center justify-center space-x-2 py-3 px-4 bg-purple-600 text-white font-semibold rounded-xl shadow-md hover:bg-purple-700 transition-colors">
          <TeacherAttendanceIcon className="w-5 h-5" />
          <span>{t('classDetailScreen.attendance')}</span>
        </button>
        <button onClick={() => navigateTo('assignmentCreator', t('classDetailScreen.newAssignment'), { classInfo })} className="flex items-center justify-center space-x-2 py-3 px-4 bg-amber-500 text-white font-semibold rounded-xl shadow-md hover:bg-amber-600 transition-colors">
          <ClipboardListIcon className="w-5 h-5" />
          <span>{t('classDetailScreen.newAssignment')}</span>
        </button>
      </div>

      {/* Student List */}
      <main className="flex-grow p-4 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-8 h-8 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin"></div>
          </div>
        ) : students.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {students.map(student => (
              <button
                key={student.id}
                onClick={() => navigateTo('studentProfile', student.name, { student, subjectContext: classInfo.subject })}
                className="w-full bg-white rounded-xl shadow-sm p-3 flex items-center space-x-4 transition-all hover:shadow-md hover:ring-2 hover:ring-purple-200"
                aria-label={`${t('classDetailScreen.viewProfileFor')} ${student.name}`}
              >
                <img src={student.avatarUrl} alt={student.name} className="w-12 h-12 rounded-full object-cover" />
                <div className="flex-grow text-left">
                  <p className="font-bold text-gray-800">{student.name}</p>
                  <p className="text-sm text-gray-500">
                    ID: {student.schoolId || t('classDetailScreen.pending')}
                    {student.curriculum_type && (
                      <span className="ml-2 text-gray-600 bg-gray-100 px-1 py-0.5 rounded text-xs">{student.curriculum_type}</span>
                    )}
                  </p>
                </div>
                <ChevronRightIcon className="text-gray-400" />
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-10 text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
            <p>{t('classDetailScreen.noStudentsFoundInThisClass')}</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default ClassDetailScreen;
