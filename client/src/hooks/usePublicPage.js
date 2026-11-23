import { useEffect, useState } from 'react';

function readPage() {
  const page = window.location.hash.slice(1);
  return ['signin', 'signup'].includes(page) ? page : 'home';
}

export function usePublicPage() {
  const [page, setPage] = useState(readPage);
  useEffect(() => {
    const updatePage = () => setPage(readPage());
    window.addEventListener('hashchange', updatePage);
    return () => window.removeEventListener('hashchange', updatePage);
  }, []);
  return page;
}
