import { createContext } from 'react';

/** Content inside an existing control must not introduce another button. */
export const NestedControlContext = createContext(false);
