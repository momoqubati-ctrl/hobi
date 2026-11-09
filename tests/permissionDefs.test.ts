import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  ADMIN_SECTION_PERMISSION_BY_ID,
  BASIC_GROUPS,
  canAccessControlPanel,
  canManageAdminSection,
  canUseVisualResource,
  canViewAdminSection,
  isPermissionActionImplemented,
  togglePermissionValue,
} from "../src/components/admin/powers/permissionDefs";

test("control panel visibility requires the cp read permission", () => {
  assert.equal(canAccessControlPanel(["cp.read"]), true);
  assert.equal(canAccessControlPanel(["cp.all"]), true);
  assert.equal(canAccessControlPanel(["admin_roles.read"]), false);
  assert.equal(canAccessControlPanel([]), false);
});

test("admin sections require their own read permission", () => {
  assert.equal(canViewAdminSection(["admin_rooms.read"], "rooms"), true);
  assert.equal(canViewAdminSection(["admin_rooms.all"], "rooms"), true);
  assert.equal(canViewAdminSection(["admin_rooms.edit"], "rooms"), false);
  assert.equal(canViewAdminSection(["admin_roles.read"], "rooms"), false);
  assert.equal(canViewAdminSection(["admin_rooms.read"], "unknown"), false);
});

test("gift commission controls have a dedicated read and edit permission", () => {
  assert.equal(ADMIN_SECTION_PERMISSION_BY_ID.giftcommission, "admin_giftcommission");
  assert.equal(canViewAdminSection(["admin_giftcommission.read"], "giftcommission"), true);
  assert.equal(isPermissionActionImplemented("admin_giftcommission", "edit"), true);
});

test("every admin navigation tab has an editable read permission in the tab permissions group", () => {
  const adminTabs = [
    "overview",
    "events",
    "actions",
    "users",
    "bans",
    "roles",
    "fltr",
    "rooms",
    "stickers",
    "swiperbanners",
    "profileframes",
    "membercardtheme",
    "icons",
    "gifts",
    "animatedfaces",
    "roomBadges",
    "siteBadges",
    "shrt",
    "msgs",
    "bots",
    "subs",
    "giftsgit",
    "agentwallets",
    "giftcommission",
    "evaluationpoints",
    "settings",
    "database",
    "micprovidercp",
    "ddosguardcp",
    "hostin",
    "hostcleanup",
    "hostcontrols",
    "hostsettings",
    "hostdomains",
  ];
  const tabPermissionResources = new Set(
    BASIC_GROUPS.find((group) => group.label === "لوحة التحكم - تبويبات")?.resources.map(({ key }) => key),
  );

  assert.equal(adminTabs.length, 34);
  assert.equal(
    new Set(adminTabs.map((tab) => ADMIN_SECTION_PERMISSION_BY_ID[tab])).size,
    adminTabs.length,
    "every admin tab must have its own permission resource",
  );
  assert.notEqual(
    ADMIN_SECTION_PERMISSION_BY_ID.gifts,
    ADMIN_SECTION_PERMISSION_BY_ID.giftsgit,
    "gift management and gift git tabs must have independent permissions",
  );
  assert.equal(canViewAdminSection(["admin_gifts.read"], "gifts"), true);
  assert.equal(canViewAdminSection(["admin_gifts.read"], "giftsgit"), false);
  assert.equal(canViewAdminSection(["admin_giftsgit.read"], "giftsgit"), true);
  assert.equal(canViewAdminSection(["admin_giftsgit.read"], "gifts"), false);

  for (const tab of adminTabs) {
    const resource = ADMIN_SECTION_PERMISSION_BY_ID[tab];
    assert.ok(resource, `${tab} must map to a permission`);
    assert.ok(tabPermissionResources.has(resource), `${resource} must appear in the tab permission group`);
    assert.equal(isPermissionActionImplemented(resource, "read"), true, `${resource}.read must be editable`);
    assert.equal(
      togglePermissionValue({}, resource, "read")[`${resource}.read`],
      true,
      `${resource}.read must be togglable on`,
    );
    assert.equal(canViewAdminSection([`${resource}.read`], tab), true, `${tab} must open with its read permission`);
    assert.equal(canViewAdminSection([], tab), false, `${tab} must stay hidden without its read permission`);
  }
});

test("existing banner, frame, theme, and icon managers support their CRUD permissions", () => {
  for (const resource of [
    "admin_swiperbanners",
    "admin_profileframes",
    "admin_membercardtheme",
    "admin_icons",
  ]) {
    for (const action of ["read", "edit", "delete", "all"]) {
      assert.equal(isPermissionActionImplemented(resource, action), true, `${resource}.${action}`);
    }
  }
});

test("default profile customization permissions are editable and enforced by UI gates", () => {
  for (const resource of ["frame", "custombg", "chattem"]) {
    assert.equal(isPermissionActionImplemented(resource, "use"), true, `${resource}.use`);
  }
  assert.equal(canUseVisualResource(["frame.use"], "frame"), true);
  assert.equal(canUseVisualResource(["custombg.use"], "frame"), false);
  assert.equal(canUseVisualResource(["chattem.use"], "chattem"), true);
});

test("voice provider permission actions can be assigned to administrators", () => {
  assert.equal(isPermissionActionImplemented("micprovideredit", "edit"), true);
  assert.equal(isPermissionActionImplemented("micprovideredit", "delete"), true);
  assert.equal(isPermissionActionImplemented("micprovideredit", "read"), false);
});

test("admin theme management controls require edit or delete permissions", () => {
  assert.equal(canManageAdminSection(["admin_profileframes.edit"], "profileframes", "edit"), true);
  assert.equal(canManageAdminSection(["admin_profileframes.all"], "profileframes", "delete"), true);
  assert.equal(canManageAdminSection(["admin_profileframes.read"], "profileframes", "edit"), false);
  assert.equal(canManageAdminSection(["admin_membercardtheme.delete"], "membercardtheme", "delete"), true);
  assert.equal(canManageAdminSection(["admin_membercardtheme.edit"], "membercardtheme", "delete"), false);
  assert.equal(canManageAdminSection(["admin_membercardtheme.edit"], "unknown", "edit"), false);
});

test("unimplemented actions are identified for read-only permission editing", () => {
  assert.equal(isPermissionActionImplemented("cp", "read"), true);
  assert.equal(isPermissionActionImplemented("cp", "edit"), false);
  assert.equal(isPermissionActionImplemented("admin_overview", "read"), true);
  assert.equal(isPermissionActionImplemented("admin_overview", "edit"), false);
  assert.equal(isPermissionActionImplemented("kick", "edit"), true);
  assert.equal(isPermissionActionImplemented("custom_permission", "read"), false);

  const pendingPermission = { "admin_overview.edit": false };
  assert.equal(togglePermissionValue(pendingPermission, "admin_overview", "edit"), pendingPermission);
});

test("turning off a resource's all permission revokes its expanded child permissions", () => {
  const permissions = togglePermissionValue(
    { "cp.all": true, "cp.read": true, "cp.edit": true, "cp.delete": true },
    "cp",
    "all",
  );

  assert.equal(permissions["cp.all"], false);
  assert.equal(permissions["cp.read"], false);
  assert.equal(permissions["cp.edit"], false);
  assert.equal(permissions["cp.delete"], false);
});
