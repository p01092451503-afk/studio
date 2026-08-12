import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { History, Film, Wallet, Boxes } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";

export function AppSidebar() {
  const { t } = useTranslation();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (path: string) =>
    pathname === path || pathname.startsWith(path + "/");
  const [email, setEmail] = useState<string>("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
  }, []);

  const groups = [
    {
      label: t("sidebar.group_studio"),
      items: [
        { title: t("sidebar.video"), url: "/video", icon: Film },
        { title: "자산고", url: "/asset-library", icon: Boxes },
      ],
    },
    {
      label: t("sidebar.group_records"),
      items: [
        { title: t("sidebar.history"), url: "/history", icon: History },
        { title: t("sidebar.usage"), url: "/usage", icon: Wallet },
      ],
    },
  ] as const;



  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader className="border-none pt-3 pb-2">
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-2 px-2"}`}>
          <Link
            to="/video"
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            
            {!collapsed && (
              <span className="text-2xl font-black tracking-tight text-foreground leading-none">
                {t("brand.name")}
              </span>
            )}
          </Link>
        </div>

      </SidebarHeader>


      <SidebarContent className="px-2 pt-4">
        {groups.map((group) => (
          <SidebarGroup key={group.label} className="px-0 py-1">
            {!collapsed && (
              <SidebarGroupLabel className="px-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1.5">
                {group.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className="h-12 rounded-2xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[active=true]:border data-[active=true]:border-border data-[active=true]:bg-card data-[active=true]:font-semibold data-[active=true]:text-foreground data-[active=true]:shadow-toss-sm"
                      >
                        <Link to={item.url} className="flex items-center gap-3">
                          <item.icon
                            className={`h-5 w-5 shrink-0 ${active ? "text-primary" : ""}`}
                            strokeWidth={2}
                          />
                          {!collapsed && <span className="truncate">{item.title}</span>}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>


    </Sidebar>
  );
}
