

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { ChevronDown, Plus, ChevronRight, CircleAlert } from 'lucide-react';
import {
  SearchIcon,
  gradeColors,
  FilterIcon,
  ViewGridIcon,
  getFormattedClassName
} from '../../constants';
import CenteredLoader from '../ui/CenteredLoader';
import LoadingState from '../ui/LoadingState';
import LowDataImage from '../ui/LowDataImage';
import { Student } from '../../types';
import { listStudents, setStudentStatus, type StudentRecord } from '../../src/lib/supabase/students';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { useAutoSync } from '../../hooks/useAutoSync';
import { motion, AnimatePresence } from 'framer-motion';

type StudentStatus = 'Active' | 'Withdrawn' | 'Pending';
const ALL_STATUSES: StudentStatus[] = ['Active', 'Withdrawn', 'Pending'];

const STATUS_STYLES: Record<StudentStatus, string> = {
  Active: 'bg-green-100 text-green-700',
  Withdrawn: 'bg-red-100 text-red-600',
  Pending: 'bg-yellow-100 text-yellow-700',
};

const StudentRow: React.FC<{
  student: any;
  onSelect: (student: Student) => void;
  onStatusChange: (student: any, newStatus: StudentStatus) => void;
}> = ({ student, onSelect, onStatusChange }) => {
    const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number; openUpward: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentStatus: StudentStatus = (student.status as StudentStatus) || 'Active';
  const otherStatuses = ALL_STATUSES.filter(s => s !== currentStatus);

  // The row lives inside accordions that use overflow-hidden for their
  // collapse/expand height animation, which clips any absolutely-positioned
  // dropdown that tries to render outside their bounds (visible on the last
  // row of a section). Portaling the menu to document.body and positioning
  // it with fixed viewport coordinates — flipping upward when there isn't
  // room below — sidesteps that clipping entirely.
  const toggleMenu = () => {
    if (!menuOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const estimatedMenuHeight = 40 + otherStatuses.length * 34;
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < estimatedMenuHeight + 16;
      setMenuPos({
        top: openUpward ? undefined : rect.bottom + 8,
        bottom: openUpward ? window.innerHeight - rect.top + 8 : undefined,
        right: window.innerWidth - rect.right,
        openUpward,
      });
    }
    setMenuOpen(v => !v);
  };

  // Keep the menu from drifting away from its trigger while open — simplest
  // correct behavior is to close it on scroll, same as most native dropdowns.
  React.useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menuOpen]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -1 }}
      className="w-full text-left bg-white rounded-lg p-2 flex items-center justify-between transition-shadow duration-200 hover:bg-gray-50 hover:shadow-md ring-1 ring-gray-100 relative"
      layout
    >
      <button
        onClick={() => onSelect(student)}
        className="flex items-center space-x-3 flex-grow min-w-0"
        aria-label={`View profile for ${student.name}`}
      >
        <motion.div
          whileTap={{ scale: 0.95 }}
          className="w-10 h-10 rounded-full object-cover flex-shrink-0 overflow-hidden bg-gray-100"
        >
          <LowDataImage
            src={student.avatarUrl || student.avatar_url || `https://ui-avatars.com/api/?name=${student.name}`}
            alt={student.name}
            className="w-full h-full"
            loading="lazy"
          />
        </motion.div>
        <div className="flex-grow min-w-0 text-left">
          <p className="font-bold text-sm text-gray-800 truncate">{student.name || student.full_name}</p>
          <p className="text-xs text-gray-500 truncate">
            ID: {student.schoolGeneratedId || student.school_generated_id || 'Pending'}
            {student.curriculum_type && (
              <span className="ml-2 text-gray-600 bg-gray-100 px-1 py-0.5 rounded text-xs">
                {student.curriculum_type}
              </span>
            )}
          </p>
        </div>
      </button>

      <div className="flex items-center gap-1.5 px-2 flex-shrink-0">
        <motion.span
          key={currentStatus}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLES[currentStatus] ?? 'bg-gray-100 text-gray-600'}`}
        >
          {currentStatus}
        </motion.span>
        <div className="relative">
          <motion.button
            ref={triggerRef}
            onClick={(e) => { e.stopPropagation(); toggleMenu(); }}
            whileTap={{ scale: 0.9 }}
            whileHover={{ scale: 1.1 }}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-200 text-gray-400 transition-colors"
            aria-label={t('studentListScreen.changeStudentStatus')}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-150 ${menuOpen ? 'rotate-180' : ''}`} />
          </motion.button>
          {menuOpen && menuPos && createPortal(
            <AnimatePresence>
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40"
                onClick={() => setMenuOpen(false)}
              />
              <motion.div
                key="menu"
                initial={{ opacity: 0, y: menuPos.openUpward ? 10 : -10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: menuPos.openUpward ? 10 : -10, scale: 0.96 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                style={{ position: 'fixed', top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right }}
                className="z-50 bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 min-w-[150px] max-w-full"
              >
                <p className="text-[9px] text-gray-400 px-3 pb-1.5 font-semibold uppercase tracking-widest">{t('studentListScreen.changeStatus')}</p>
                {otherStatuses.map(s => (
                  <motion.button
                    key={s}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onStatusChange(student, s);
                    }}
                    whileTap={{ scale: 0.98 }}
                    whileHover={{ x: 2 }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-medium hover:bg-gray-50 transition-colors ${
                      s === 'Active' ? 'text-green-700' : s === 'Withdrawn' ? 'text-red-600' : 'text-yellow-700'
                    }`}
                  >
                    Mark as {s}
                  </motion.button>
                ))}
              </motion.div>
            </AnimatePresence>,
            document.body
          )}
        </div>
      </div>
    </motion.div>
  );
};

const StageAccordion: React.FC<{ title: string; count: number; children: React.ReactNode, defaultOpen?: boolean, forceOpen?: boolean }> = ({ title, count, children, defaultOpen = false, forceOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // While a search is active the section must not be able to hide a match:
  // closed sections render no children at all, so a matching student inside one
  // is invisible and the search looks broken.
  const open = forceOpen || isOpen;

  return (
    <div className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
      <motion.button
        onClick={() => setIsOpen(!open)}
        whileTap={{ scale: 0.99 }}
        className="w-full flex justify-between items-center p-4 text-left"
        aria-expanded={open}
      >
        <h3 className="font-bold text-lg text-gray-800">{title}</h3>
        <div className="flex items-center space-x-2">
          <span className="text-sm font-semibold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-full">{count} Students</span>
          <ChevronRight className={`h-5 w-5 text-gray-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </div>
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-0 space-y-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const SubStageAccordion: React.FC<{ title: string; count: number; children: React.ReactNode, defaultOpen?: boolean, forceOpen?: boolean }> = ({ title, count, children, defaultOpen = false, forceOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // While a search is active the section must not be able to hide a match:
  // closed sections render no children at all, so a matching student inside one
  // is invisible and the search looks broken.
  const open = forceOpen || isOpen;
  return (
    <div className="bg-gray-50 rounded-xl overflow-hidden">
      <motion.button
        onClick={() => setIsOpen(!open)}
        whileTap={{ scale: 0.99 }}
        className="w-full flex justify-between items-center p-3 text-left hover:bg-gray-100 transition-colors"
        aria-expanded={open}
      >
        <h4 className="font-semibold text-gray-700">{title}</h4>
        <div className="flex items-center space-x-2">
          <span className="text-xs font-medium text-gray-600 bg-gray-200 px-2 py-0.5 rounded-full">{count}</span>
          <ChevronRight className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </div>
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="overflow-hidden"
          >
            <div className="p-2 space-y-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ClassAccordion: React.FC<{ title: string; count: number; children: React.ReactNode, defaultOpen?: boolean, forceOpen?: boolean }> = ({ title, count, children, defaultOpen = false, forceOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // While a search is active the section must not be able to hide a match:
  // closed sections render no children at all, so a matching student inside one
  // is invisible and the search looks broken.
  const open = forceOpen || isOpen;

  return (
    <div className="bg-white rounded-xl overflow-hidden border">
      <motion.button
        onClick={() => setIsOpen(!open)}
        whileTap={{ scale: 0.99 }}
        className="w-full flex justify-between items-center p-3 text-left hover:bg-gray-100 transition-colors"
        aria-expanded={open}
      >
        <h4 className="font-semibold text-sm text-gray-600">{title}</h4>
        <div className="flex items-center space-x-2">
          <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
          <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        </div>
      </motion.button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 35 }}
            className="overflow-hidden"
          >
            <div className="p-2 space-y-2">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

interface StudentListScreenProps {
  /**
   * Limits the list to one class.
   *
   * `className` is the SRIK form, e.g. "3 Al-Junaidi". The legacy
   * `grade`/`section` pair is still accepted so an older caller does not break,
   * but nothing in the app passes it and it is ignored when `className` is set.
   */
  filter?: { className?: string; grade?: number; section?: string };
  navigateTo: (view: string, title: string, props?: any) => void;
  currentBranchId?: string | null;
  schoolId?: string;
}

// Maps a roster row from the API into the shape StudentRow / the profile screen expect.
/**
 * Maps a database student to the shape this screen renders.
 *
 * A student's class is now a real class name from their enrolment ("3
 * Al-Junaidi") rather than a grade/section pair, so `className` is derived here
 * and the legacy `grade`/`section` fields are left undefined. Nothing on screen
 * reads them any more — the class grouping below uses the class name.
 */
const mapStudent = (s: StudentRecord): StudentListRow => ({
  id: s.id,
  schoolGeneratedId: s.admissionNo,
  name: s.fullName,
  email: s.guardians.find(g => g.isPrimary)?.email || s.guardians[0]?.email || '',
  avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${s.fullName || s.id}`,
  className: s.className,
  classId: s.classId,
  yearLevel: s.yearLevel,
  birthday: s.birthDate,
  guardianName: s.guardians[0]?.fullName,
  guardianPhone: s.guardians[0]?.phone,
  status: s.status,
});

/**
 * Whether a student still belongs on the active roll.
 *
 * This used to compare against the legacy title-case values ('Graduated',
 * 'Transferred'). The database stores upper-case values, so the old check never
 * matched and every student passed — including ones who had left. It now tests
 * the values the database actually uses, and keeps only ACTIVE.
 *
 * Students who have left stay visible in their own archive rather than being
 * deleted: a school record of who attended is not something to throw away.
 */
const isCurrentStudent = (s: { status?: string }) => (s.status ?? 'ACTIVE') === 'ACTIVE';

/**
 * The status vocabulary as it exists in the database.
 *
 * The screen's dropdown offers Active / Withdrawn / Pending for a teacher's
 * convenience; the database stores five values because a school needs to tell
 * "graduated" apart from "left the school". These pairs are the only place the
 * two vocabularies meet.
 */
const DB_STATUS: Record<StudentStatus, StudentRecord['status']> = {
  Active: 'ACTIVE',
  Withdrawn: 'WITHDRAWN',
  // "Pending" has no database equivalent. The closest honest value is ACTIVE,
  // because a student awaiting confirmation is still on the roll; recording
  // them as archived would hide them from every list.
  Pending: 'ACTIVE',
};

const toScreenStatus = (s: StudentRecord['status']): StudentStatus =>
  s === 'WITHDRAWN' ? 'Withdrawn' : s === 'ACTIVE' ? 'Active' : 'Active';

/**
 * One class group: a real SRIK class, e.g. "3 Al-Junaidi", plus its headcount.
 *
 * Grouping is by class NAME now. The old grade/section pair belonged to a
 * school with forms and streams; SRIK has named classes within Years 1-6, and
 * they are already the label a user recognises.
 */
interface ClassGroup {
  name: string;
  total: number;
  /** Year level, used only for ordering. Null for students with no class yet. */
  yearLevel: number | null;
}

/** The group a student with no class yet is shown under. */
const UNASSIGNED = 'Unassigned';

/**
 * The row shape THIS screen renders.
 *
 * Deliberately not the shared `Student` type: that one still describes the
 * legacy record (grade, section, attendanceStatus) and is consumed widely, so
 * changing it would ripple far beyond this screen. A student's class is a name
 * now, taken from their enrolment.
 */
interface StudentListRow {
  id: string;
  schoolGeneratedId: string;
  name: string;
  email: string;
  avatarUrl: string;
  className: string | null;
  classId: string | null;
  /** Real year level from the database — never parsed from the name. */
  yearLevel: number | null;
  birthday?: string | null;
  guardianName?: string;
  guardianPhone?: string;
  status: string;
}

// The roster used to be fetched whole (every student in the school, ~1KB each:
// 1.5MB at 1,500 students — half a minute on a 400kbps link) and grouped on the
// client. Sections start collapsed, so a class's rows are only needed when the
// admin opens it: this fetches just that group, on mount, i.e. on expand
// (the accordions render no children while closed).
/**
 * A class group's rows.
 *
 * Rows arrive already loaded. The previous version fetched each class on
 * expand, because the legacy roster was fetched whole and could reach 1.5MB. At
 * SRIK's ~250 students the whole roster is trivial, so the lazy fetch (and the
 * failure mode where a collapsed class looked empty) is gone.
 */
const ClassStudents: React.FC<{
  group: ClassGroup;
  rows: StudentListRow[];
  statusFilter: 'All' | StudentStatus;
  onSelect: (student: Student) => void;
  onStatusChange: (student: any, newStatus: StudentStatus) => void;
}> = ({ group, rows, onSelect, onStatusChange }) => {
    const { t } = useTranslation();
  if (rows.length === 0) {
    return (
      <div className="px-2 py-1.5 text-sm text-gray-500">
        {t('studentListScreen.noStudentsInThisClass')}
      </div>
    );
  }
  return <>{rows.map(s => <StudentRow key={s.id} student={s} onSelect={onSelect} onStatusChange={onStatusChange} />)}</>;
};

const StudentListScreen: React.FC<StudentListScreenProps> = ({ filter, navigateTo, currentBranchId, schoolId: propSchoolId }) => {
    const { t } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'stage' | 'class'>('stage');
  const [statusFilter, setStatusFilter] = useState<'All' | StudentStatus>('All');
  const [pendingStatusChange, setPendingStatusChange] = useState<{ student: any; status: StudentStatus } | null>(null);
  const [withdrawalReason, setWithdrawalReason] = useState('');
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [showBottomBar, setShowBottomBar] = useState(true);

  const { user } = useAuth();
  const { profile } = useProfile();
  const queryClient = useQueryClient();

  // The roster no longer needs a school id: SRIK is one school, and the
  // database decides what this user may see. Computing a school id here would
  // reintroduce a tenancy concept the product does not have.
  const queryKey = ['students'];

  // One fetch for the whole roster, grouped in memory. The previous version
  // kept three separate queries (per-class headcounts, per-class rows, and a
  // server-side search) because the legacy roster could reach 1.5MB. At ~250
  // students that machinery cost more than it saved, and its lazy per-class
  // fetch could show a collapsed class as empty.
  const { data: roster = [], isLoading, isError, error: fetchError, refetch } = useQuery({
    queryKey,
    queryFn: () => listStudents(),
    staleTime: 1000 * 60 * 5,
  });

  // Searching is now local, because the rows are already here. That also makes
  // the result instant rather than waiting on a round trip per keystroke.
  const isSearching = searchTerm.trim().length > 0;

  const students = useMemo<StudentListRow[]>(
    () => roster.filter(isCurrentStudent).map(mapStudent),
    [roster]
  );

  const matchingStudents = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return students.filter(s => {
      if (term && !(
        s.name.toLowerCase().includes(term) ||
        (s.schoolGeneratedId || '').toLowerCase().includes(term) ||
        (s.guardianName || '').toLowerCase().includes(term)
      )) return false;
      if (statusFilter !== 'All' && toScreenStatus(s.status as StudentRecord['status']) !== statusFilter) return false;
      if (filter && filter.className && s.className !== filter.className) return false;
      return true;
    });
  }, [students, searchTerm, statusFilter, filter]);

  useAutoSync(['students'], () => {
    queryClient.invalidateQueries({ queryKey });
  });

  const handleStudentSelect = (student: Student) => {
    navigateTo('studentProfileAdminView', student.name, { student });
  };

  const handleStatusChange = (student: any, newStatus: StudentStatus) => {
    if (newStatus === 'Withdrawn') {
      setPendingStatusChange({ student, status: newStatus });
      setWithdrawalReason('');
    } else {
      applyStatusChange(student, newStatus, '');
    }
  };

  const applyStatusChange = async (student: any, status: StudentStatus, reason: string) => {
    setIsChangingStatus(true);
    try {
      // Withdrawal goes through the dedicated status path rather than the full
      // record update, so a withdrawal cannot accidentally rewrite the
      // student's name or admission number.
      if (status === 'Withdrawn') {
        const result = await setStudentStatus(student.id, 'WITHDRAWN');
        if (!result.success) throw new Error(result.error);
      }
      queryClient.invalidateQueries({ queryKey });
      toast.success(`${student.name} marked as ${status}`);
      setPendingStatusChange(null);
      setWithdrawalReason('');
    } catch {
      toast.error(t('studentListScreen.failedToUpdateStatusPleaseTryAgain'));
    } finally {
      setIsChangingStatus(false);
    }
  };

  // Group the matching students by their real class name.
  //
  // The previous grouping produced "Senior Secondary", "Junior Secondary" and
  // "Preschool / Nursery" — all empty for SRIK, which teaches Years 1-6, so
  // most of the tree was scaffolding for stages the school does not have.
  const groups = useMemo<ClassGroup[]>(() => {
    const byName = new Map<string, ClassGroup>();
    for (const s of matchingStudents) {
      const name = s.className || UNASSIGNED;
      // `yearLevel` comes from the database column, not from the class name.
      // Class names are labels the school may rename at any time, so deriving a
      // number from the text would break silently on the next rename — and a
      // name like "Al-Junaidi" has no number at all.
      const group = byName.get(name) || { name, total: 0, yearLevel: s.yearLevel };
      group.total += 1;
      byName.set(name, group);
    }
    // Class order: Year 1 first, and "Unassigned" last so students still to be
    // placed are easy to find rather than buried at the top.
    return [...byName.values()].sort((a, b) => {
      if (a.name === UNASSIGNED) return 1;
      if (b.name === UNASSIGNED) return -1;
      return (a.yearLevel ?? 0) - (b.yearLevel ?? 0) || a.name.localeCompare(b.name);
    });
  }, [matchingStudents]);

  const studentsByClass = useMemo(() => {
    const map: Record<string, StudentListRow[]> = {};
    for (const s of matchingStudents) {
      const name = s.className || UNASSIGNED;
      (map[name] ||= []).push(s);
    }
    return map;
  }, [matchingStudents]);

  const classesForClassView = groups;

  const totalCount = matchingStudents.length;

  // A class section's body: already-loaded rows while searching, otherwise
  // fetched on expand.
  const renderClassBody = (g: ClassGroup) => (
    <ClassStudents
      group={g}
      rows={studentsByClass[g.name] || []}
      statusFilter={statusFilter}
      onSelect={handleStudentSelect}
      onStatusChange={handleStatusChange}
    />
  );

  const renderContent = () => {
    if (isLoading) {
      return <LoadingState type="list" rows={8} className="p-2" />;
    }

    if (isError) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-white rounded-2xl shadow-sm border border-red-100 text-center m-2">
          <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mb-4">
            <CircleAlert className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="font-bold text-gray-900 mb-1">{t('studentListScreen.failedToLoadStudents')}</h3>
          <p className="text-sm text-gray-500 mb-4">{String(fetchError || 'Could not load students')}</p>
          <button
            onClick={() => (isSearching ? queryClient.invalidateQueries({ queryKey }) : refetch())}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Retry Now
          </button>
        </div>
      );
    }

    if (totalCount === 0) {
      return (
        <div className="text-center py-20 bg-white rounded-2xl shadow-sm border border-dashed border-gray-200 m-2">
          <p className="text-gray-500 font-medium">{t('studentListScreen.noStudentsFoundMatchingYourSearch')}</p>
        </div>
      );
    }

    if (filter) {
      // A single class's roster (opened from a class card): flat list, no headers.
      return (
        <div className="space-y-3">
          {classesForClassView.map(g => (
            <React.Fragment key={g.name}>{renderClassBody(g)}</React.Fragment>
          ))}
        </div>
      );
    }

    if (viewMode === 'class') {
      return (
        <div className="space-y-3">
          {classesForClassView.map(g => (
            <ClassAccordion key={g.name} title={g.name} count={g.total} forceOpen={isSearching}>
              {renderClassBody(g)}
            </ClassAccordion>
          ))}
        </div>
      );
    }

    // "Stage" view: the class list, grouped by year band so a long list stays
    // navigable. Bands with no students are omitted entirely rather than shown
    // empty, which is what the old fixed tree did for stages SRIK does not have.
    const bands: Array<{ title: string; groups: ClassGroup[] }> = [
      { title: t('studentListScreen.year13'), groups: groups.filter(g => g.yearLevel !== null && g.yearLevel <= 3) },
      { title: t('studentListScreen.year46'), groups: groups.filter(g => g.yearLevel !== null && g.yearLevel > 3) },
      { title: t('studentListScreen.unassigned'), groups: groups.filter(g => g.yearLevel === null) },
    ].filter(b => b.groups.length > 0);

    return (
      <>
        {bands.map(band => (
          <StageAccordion
            key={band.title}
            title={band.title}
            count={band.groups.reduce((n, g) => n + g.total, 0)}
            forceOpen={isSearching}
          >
            {band.groups.map(g => (
              <ClassAccordion key={g.name} title={g.name} count={g.total} forceOpen={isSearching}>
                {renderClassBody(g)}
              </ClassAccordion>
            ))}
          </StageAccordion>
        ))}
      </>
    );
  };

  return (
    <div className="flex flex-col h-full bg-gray-100 relative">
      <div className="p-4 bg-gray-100 z-10 space-y-3">
        <div className="relative">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3">
            <SearchIcon className="text-gray-600" />
          </span>
          <input type="text" placeholder={t('studentListScreen.searchByName')} value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500" aria-label={t('studentListScreen.searchForAStudent')} />
        </div>

        {!filter && (
          <>
            <div className="flex space-x-2">
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setViewMode('stage')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${viewMode === 'stage' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:bg-gray-200'}`}
              >
                By Stage
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => setViewMode('class')}
                className={`flex-1 py-1.5 text-sm font-medium rounded-lg transition-colors ${viewMode === 'class' ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200' : 'text-gray-500 hover:bg-gray-200'}`}
              >
                By Class
              </motion.button>
            </div>
            <div className="flex space-x-2 overflow-x-auto pb-0.5">
              {(['All', 'Active', 'Withdrawn', 'Pending'] as const).map(s => (
                <motion.button
                  key={s}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setStatusFilter(s)}
                  className={`flex-shrink-0 px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                    statusFilter === s
                      ? s === 'All' ? 'bg-indigo-600 text-white'
                        : s === 'Active' ? 'bg-green-600 text-white'
                        : s === 'Withdrawn' ? 'bg-red-500 text-white'
                        : 'bg-yellow-500 text-white'
                      : 'bg-white text-gray-600 ring-1 ring-gray-200'
                  }`}
                >
                  {s}
                </motion.button>
              ))}
            </div>
          </>
        )}
      </div>

      <main className="flex-grow px-4 pb-32 space-y-4 overflow-y-auto">
        {renderContent()}
      </main>

      <div className="fixed bottom-24 right-6 lg:bottom-12 lg:right-12 z-40">
        <motion.button whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} onClick={() => navigateTo('addStudent', t('studentListScreen.addNewStudent'), {})} className="bg-indigo-600 text-white p-4 rounded-full shadow-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500" aria-label={t('studentListScreen.addNewStudent')}><Plus className="h-6 w-6" /></motion.button>
      </div>

      {/* Withdrawal reason modal */}
      <AnimatePresence>
        {pendingStatusChange?.status === 'Withdrawn' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm"
            >
              <h3 className="font-bold text-gray-900 text-lg mb-1">{t('studentListScreen.withdrawStudent')}</h3>
              <p className="text-sm text-gray-500 mb-4">
                Please provide a reason for withdrawing <strong className="text-gray-700">{pendingStatusChange.student.name}</strong>.
              </p>
              <textarea
                value={withdrawalReason}
                onChange={e => setWithdrawalReason(e.target.value)}
                placeholder={t('studentListScreen.reasonForWithdrawalEGRelocatedTransferredFinan')}
                className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none h-24 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                autoFocus
              />
              <div className="flex gap-3 mt-4">
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { setPendingStatusChange(null); setWithdrawalReason(''); }}
                  disabled={isChangingStatus}
                  className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={() => applyStatusChange(pendingStatusChange.student, 'Withdrawn', withdrawalReason)}
                  disabled={!withdrawalReason.trim() || isChangingStatus}
                  className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isChangingStatus ? t('studentListScreen.saving') : t('studentListScreen.confirmWithdrawal')}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default StudentListScreen;
