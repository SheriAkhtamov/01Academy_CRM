import { createContext, useContext } from 'react';

export type OpenEmployeeCard = (userId: number, trigger?: HTMLElement) => void;
export const EmployeeCardContext = createContext<OpenEmployeeCard | null>(null);
export const useEmployeeCard = () => useContext(EmployeeCardContext);
