import React from 'react';
import { Link } from 'react-router-dom';
import { Image as ImageIcon, Package, Plus } from 'lucide-react';

export const MediaHomePage: React.FC = () => (
  <div className="page-content fade-in media-home-page">
    <section className="panel glass media-home-page__hero">
      <div className="media-home-page__icon" aria-hidden>
        <ImageIcon size={28} />
      </div>
      <h1>Media</h1>
      <p className="text-muted">
        Open the catalog, pick a product, then use the Media tab to add images, PDFs, or videos.
        Each file needs a short description.
      </p>
      <ol className="media-home-page__steps">
        <li>
          <Package size={16} aria-hidden />
          Browse or search the catalog
        </li>
        <li>
          Open a product
        </li>
        <li>
          <Plus size={16} aria-hidden />
          On the Media tab, tap + to upload
        </li>
      </ol>
      <Link to="/media/catalog" className="btn btn-primary">
        Open catalog
      </Link>
    </section>
  </div>
);
