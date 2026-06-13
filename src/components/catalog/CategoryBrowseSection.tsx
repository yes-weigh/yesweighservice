import React from 'react';

export const CategoryBrowseSection: React.FC<{
  hint?: React.ReactNode;
  children: React.ReactNode;
}> = ({ hint, children }) => (
  <section className="catalog-categories">
    <div className="catalog-categories__heading">
      <h3 className="catalog-categories__title">
        <span className="catalog-categories__accent" aria-hidden />
        Browse Categories
      </h3>
      {hint}
    </div>
    <div className="catalog-categories__grid">{children}</div>
  </section>
);
