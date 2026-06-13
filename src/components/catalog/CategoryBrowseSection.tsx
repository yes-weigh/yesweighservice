import React from 'react';

export const CategoryBrowseSection: React.FC<{
  hint?: React.ReactNode;
  showHeading?: boolean;
  children: React.ReactNode;
}> = ({ hint, showHeading = true, children }) => (
  <section className={`catalog-categories ${showHeading ? '' : 'catalog-categories--bare'}`}>
    {showHeading && (
      <div className="catalog-categories__heading">
        <h3 className="catalog-categories__title">
          <span className="catalog-categories__accent" aria-hidden />
          Browse Categories
        </h3>
        {hint}
      </div>
    )}
    <div className="catalog-categories__grid">{children}</div>
  </section>
);
