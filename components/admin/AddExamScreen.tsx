import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'react-hot-toast';
import { Exam } from '../../types';
import { listClassOptions, listSubjectOptions } from '../../src/lib/supabase/academics';
import { useAuth } from '../../context/AuthContext';
import CenteredLoader from '../ui/CenteredLoader';


interface AddExamScreenProps {
  onSave: (exam: Omit<Exam, 'id' | 'isPublished' | 'teacherId'>) => void;
  examToEdit?: Exam | null;
}

const AddExamScreen: React.FC<AddExamScreenProps> = ({ onSave, examToEdit }) => {
  const { currentSchool, currentBranchId } = useAuth();
  const [examType, setExamType] = useState('');
  const [date, setDate] = useState('');
  const [className, setClassName] = useState('');
  const [subject, setSubject] = useState('');

  const [availableClasses, setAvailableClasses] = useState<any[]>([]);
  const [availableSubjects, setAvailableSubjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFormData = async () => {
      setLoading(true);
      try {
        // The classes and subjects the school actually has.
        //
        // This called `api.getMe()`, `api.getClasses()` and `api.getSubjects()` on an
        // Express server that is not deployed, so both dropdowns were empty and an
        // exam could not be created at all. It also branched on the user's role and
        // walked `teacher.classes` out of the profile response — a shape that no
        // longer exists. The database decides what a teacher may see through row
        // level security, so both roles read the same two lists and no branch is
        // needed.
        const [classes, subjects] = await Promise.all([
          listClassOptions(),
          listSubjectOptions(),
        ]);
        const classList = classes.map(c => ({ name: c.label, id: c.id }));
        const subjectList = subjects.map(s => ({ name: s.label, id: s.id }));
        setAvailableClasses(classList);
        setAvailableSubjects(subjectList);

        // An exam being edited arrives with a subject NAME, not an id. The select
        // holds ids, so the name is resolved here rather than being left as text
        // the picker cannot match — which would silently show the first subject.
        if (examToEdit?.subject) {
          const match = subjectList.find(
            o => o.name === examToEdit.subject || o.name.split(' — ')[0] === examToEdit.subject,
          );
          if (match) setSubject(match.id);
        }
      } catch (err) {
        console.error('Error fetching exam form data:', err);
        toast.error('Failed to load form data');
      } finally {
        setLoading(false);
      }
    };

    fetchFormData();

    if (examToEdit) {
      setExamType(examToEdit.type || '');
      setDate(examToEdit.date || '');
      // Preselect by ID when the caller supplied one, so the edit form opens on the
      // exam's actual class rather than on whatever carries the same label today.
      setClassName(examToEdit.classId || '');
      // The subject arrives as a NAME and these lists are not loaded yet at this
      // point, so the name is kept and resolved to an id after the lists arrive.
      setSubject(examToEdit.subject || '');
    }
  }, [examToEdit]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // The selects hold IDs, so the class name is only needed to show a description
    // in the confirmation. The ID is what is passed on, and it is the only thing
    // the database can use.
    const cls = availableClasses.find(c => c.id === className);
    const sub = availableSubjects.find(s => s.id === subject);
    if (examType && date && cls && sub) {
      onSave({ type: examType, date, className: cls.name, classId: cls.id, subject: sub.name });
    } else {
      toast.error('Please fill all fields.');
    }
  };

  // WAEC/NECO are foreign national exam boards this school does not sit; the
  // school's own exam types are used instead.
  const examTypes = ['Mid-term', 'Final', 'Quiz', 'Test', 'Assessment', 'Ujian', 'IGCSE', 'CHECKPOINT'];

  if (loading && availableClasses.length === 0) {
    return <CenteredLoader message="Loading form data..." className="p-8" />;
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
        <main className="flex-grow p-4 space-y-4 overflow-y-auto">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="space-y-4 bg-white p-4 rounded-xl shadow-sm">
            <div>
              <label htmlFor="examType" className="block text-sm font-medium text-gray-700 mb-1">Exam Type</label>
              <select id="examType" value={examType} onChange={e => setExamType(e.target.value)} required className="w-full px-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-sky-500 focus:border-sky-500">
                <option value="" disabled>Select type...</option>
                {examTypes.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="date" className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required className="w-full px-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-sky-500 focus:border-sky-500" />
            </div>
            <div>
              <label htmlFor="className" className="block text-sm font-medium text-gray-700 mb-1">Class</label>
              <select id="className" value={className} onChange={e => setClassName(e.target.value)} required className="w-full px-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-sky-500 focus:border-sky-500">
                <option value="" disabled>Select class...</option>
                {/* The ID is the value. Two classes can share a label across years,
                    and the label is something the school renames. */}
                {availableClasses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                {availableClasses.length === 0 && <option value="" disabled>No classes found in database</option>}
              </select>
            </div>
            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <select id="subject" value={subject} onChange={e => setSubject(e.target.value)} required className="w-full px-3 py-3 text-gray-700 bg-gray-50 border border-gray-300 rounded-lg focus:ring-sky-500 focus:border-sky-500">
                <option value="" disabled>Select subject...</option>
                {Array.from(new Map(availableSubjects.map(sub => [sub.name, sub])).values()).map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
              </select>
            </div>
          </motion.div>
        </main>
        <div className="p-4 mt-auto bg-gray-50 border-t border-gray-200">
          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} type="submit" className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm font-medium text-white bg-sky-500 hover:bg-sky-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500">
            {examToEdit ? 'Update Exam' : 'Save Exam'}
          </motion.button>
        </div>
      </form>
    </div>
  );
};
export default AddExamScreen;
