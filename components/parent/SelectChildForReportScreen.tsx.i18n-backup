import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useAutoSync } from '../../hooks/useAutoSync';
import { listMyChildren } from '../../src/lib/supabase/family';
import { getCurrentTerm, listReportCards } from '../../src/lib/supabase/assessments';
import { Student } from '../../types';
import { ChevronRightIcon, ReportIcon } from '../../constants';

interface SelectChildForReportScreenProps {
  navigateTo: (view: string, title: string, props?: any) => void;
  parentId?: string | null;
  currentUserId?: string | null; // Added
  schoolId?: string;
}

const SelectChildForReportScreen: React.FC<SelectChildForReportScreenProps> = ({ navigateTo, parentId, currentUserId, schoolId }) => {
  const [children, setChildren] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChildren = useCallback(async () => {
    try {
      const children = await listMyChildren();

      // Which of these children actually HAVE a report card, and in what state.
      //
      // The old comment here said the child list came with `report_cards` attached and
      // that dropping it was why parents always saw "No Published Reports". There is no
      // such attached field — report cards live in their own table, for a TERM. So it is
      // read here, for the current term, and the count is what the picker shows.
      const term = await getCurrentTerm();
      const cards = term ? await listReportCards(term.id) : [];
      const byChild = new Map<string, typeof cards>();
      for (const c of cards) {
        const list = byChild.get(c.studentId) ?? [];
        list.push(c);
        byChild.set(c.studentId, list);
      }

      const mappedStudents = children.map(c => ({
        id: c.student.id,
        name: c.student.fullName,
        grade: c.student.className || '',
        section: '',
        reportCards: (byChild.get(c.student.id) ?? []).map(rc => ({
          id: rc.id,
          // The TERM ID, not just its name. The report card screen reads the frozen
          // snapshot by term id; a name is a label the school can rename, and matching
          // on it would find nothing the moment they did.
          termId: rc.academicTermId,
          session: rc.termName,
          term: rc.termName,
          // Only PUBLISHED cards are worth showing a parent. A draft is the office's
          // working copy and has not been given to anyone yet.
          status: rc.status === 'PUBLISHED' || rc.status === 'SUPERSEDED' ? 'Published' : 'Draft',
          gradeAverage: null,
          position: null,
          totalStudents: null,
        })),
      } as unknown as Student));
      setChildren(mappedStudents);
    } catch (err) {
      console.error("Error fetching children for report:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Real-time synchronization
  useAutoSync(['student_parent_links', 'students'], fetchChildren);

  useEffect(() => {
    fetchChildren();
  }, [fetchChildren]);

  if (loading) return <div className="p-8 text-center">Loading children...</div>;

  const handleSelectChild = (student: Student) => {
    navigateTo('selectReportTerm', `${student.name}'s Report`, { student });
  };

  return (
    <div className="p-4 space-y-4 bg-gray-50 h-full">
      <div className="bg-green-50 p-4 rounded-xl text-center border border-green-200">
        <ReportIcon className="h-10 w-10 mx-auto text-green-400 mb-2" />
        <h3 className="font-bold text-lg text-green-800">Select a Child</h3>
        <p className="text-sm text-green-700">Choose a child to view their latest academic report card.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {children.map((child, i) => (
          <motion.button
            key={child.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(i, 10) * 0.05 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => handleSelectChild(child)}
            className="w-full bg-white rounded-xl shadow-sm hover:shadow-md p-4 flex items-center justify-between text-left hover:ring-2 hover:ring-green-200 transition-shadow"
          >
            <div className="flex items-center space-x-4">
              {child.avatarUrl ? (
                <img src={child.avatarUrl} alt={child.name} className="w-14 h-14 rounded-full object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-bold text-xl">
                  {child.name.charAt(0)}
                </div>
              )}
              <div>
                <p className="font-bold text-gray-800">{child.name}</p>
                <p className="text-sm text-gray-600">Grade {child.grade}{child.section}</p>
              </div>
            </div>
            <ChevronRightIcon className="text-gray-400" />
          </motion.button>
        ))}
      </div>
    </div>
  );
};

export default SelectChildForReportScreen;