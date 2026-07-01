"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ChevronDown, FolderKanban, LogOut, PanelLeftClose, Plus } from "lucide-react";

import { DASHBOARD_NAV_GROUPS, isDashboardEntryActive } from "@/components/dashboard-nav";
import { ProjectSetupModal } from "@/components/project-setup-modal";
import { SiteFavicon } from "@/components/site-favicon";
import { useSiteIntent } from "@/components/site-intent-provider";
import siteLogo from "../Si-Logo.png";

type AppSidebarProps = {
  open: boolean;
  onClose: () => void;
};

export function AppSidebar({ open, onClose }: AppSidebarProps) {
  const pathname = usePathname();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const { projects, activeProjectId, selectProject, signOut } = useSiteIntent();
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? projects[0] ?? null;

  return (
    <aside className="app-sidebar" data-open={open ? "true" : "false"} aria-label="Primary navigation">
      <div className="app-sidebar__panel">
        <div className="app-sidebar__mobile-header">
          <div className="mobile-topbar__brand">
            <Image className="app-logo" src={siteLogo} alt="Site Intent" width={32} height={32} priority />
            <div className="app-sidebar__brand-copy">
            <div className="app-sidebar__title">Site Intent</div>
          </div>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close navigation">
            <PanelLeftClose size={18} />
          </button>
        </div>

        <div className="app-sidebar__brand">
          <Image className="app-logo" src={siteLogo} alt="Site Intent" width={32} height={32} priority />
          <div className="app-sidebar__brand-copy">
            <div className="app-sidebar__title">Site Intent</div>
          </div>
        </div>

        <div className="project-switcher">
          <div className="project-switcher__label">Websites</div>
          {projects.length ? (
            <>
              <button
                className="project-switcher__item project-switcher__item--trigger"
                type="button"
                onClick={() => setProjectMenuOpen((current) => !current)}
                aria-expanded={projectMenuOpen}
              >
                {activeProject ? (
                  <SiteFavicon
                    url={activeProject.websiteUrl}
                    faviconUrl={activeProject.websiteFaviconUrl}
                    alt={`${activeProject.name} favicon`}
                    className="site-favicon site-favicon--small"
                  />
                ) : (
                  <div className="project-switcher__icon">
                    <FolderKanban size={14} />
                  </div>
                )}
                <div className="project-switcher__copy">
                  <strong>{activeProject?.name ?? "Select website"}</strong>
                  <span>{activeProject?.websiteDisplayUrl ?? "Choose a website"}</span>
                </div>
                <ChevronDown className="project-switcher__chevron" size={16} />
              </button>
              {projectMenuOpen ? (
                <div className="project-switcher__menu">
                  {projects.map((project) => {
                    const active = project.id === activeProject?.id;
                    return (
                      <button
                        key={project.id}
                        className="project-switcher__option"
                        type="button"
                        data-active={active ? "true" : "false"}
                        onClick={() => {
                          selectProject(project.id);
                          setProjectMenuOpen(false);
                          onClose();
                        }}
                      >
                        <SiteFavicon
                          url={project.websiteUrl}
                          faviconUrl={project.websiteFaviconUrl}
                          alt={`${project.name} favicon`}
                          className="site-favicon site-favicon--small"
                        />
                        <div className="project-switcher__copy">
                          <span>{project.name}</span>
                          <small>{project.websiteDisplayUrl}</small>
                        </div>
                      </button>
                    );
                  })}
                  <ProjectSetupModal
                    buttonClassName="project-switcher__add"
                    lockWhenNoWebsites
                    onOpenChange={(isOpen) => {
                      if (!isOpen) {
                        setProjectMenuOpen(false);
                      }
                    }}
                    trigger={(
                      <>
                        <Plus size={14} />
                        Add website
                      </>
                    )}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <ProjectSetupModal
              buttonClassName="button button--secondary"
              buttonLabel="Add website"
              lockWhenNoWebsites
              onOpenChange={(isOpen) => !isOpen && onClose()}
            />
          )}
        </div>

        <nav className="nav-stack">
          {DASHBOARD_NAV_GROUPS.map((group) => (
            <section key={group.label} className="nav-group">
              <div className="nav-group__label">{group.label}</div>
              <div className="nav-list">
                {group.items.map((item) => {
                  const active = isDashboardEntryActive(pathname, item);
                  const Icon = item.icon;

                  return (
                    <Link
                      key={item.href}
                      className="nav-link"
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={onClose}
                    >
                      <Icon className="nav-link__icon" size={18} />
                      <div className="nav-link__copy">
                        <span className="nav-link__title">{item.title}</span>
                        <span className="nav-link__description">{item.description}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="app-sidebar__footer">
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              signOut();
              onClose();
            }}
          >
            Sign out
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
